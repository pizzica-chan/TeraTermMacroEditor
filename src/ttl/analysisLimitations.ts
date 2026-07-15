export interface UnassumedBranchLimitation {
  sourceName: string
  line: number
  conditionText: string
}

export interface UnlinkedIncludeLimitation {
  sourceName: string
  line: number
  raw: string
}

export interface AnalysisLimitations {
  unassumedBranches: UnassumedBranchLimitation[]
  unlinkedIncludes: UnlinkedIncludeLimitation[]
}

export const EMPTY_ANALYSIS_LIMITATIONS: AnalysisLimitations = {
  unassumedBranches: [],
  unlinkedIncludes: [],
}

export function hasAnalysisLimitations(limitations: AnalysisLimitations): boolean {
  return limitations.unassumedBranches.length > 0 || limitations.unlinkedIncludes.length > 0
}

export function formatAnalysisLimitationWarning(limitations: AnalysisLimitations): string {
  const reasons: string[] = []
  if (limitations.unassumedBranches.length > 0) {
    reasons.push(`True/False 未選択の分岐: ${limitations.unassumedBranches.length} 件`)
  }
  if (limitations.unlinkedIncludes.length > 0) {
    reasons.push(`タブ未指定の include: ${limitations.unlinkedIncludes.length} 件`)
  }
  return [
    '解析条件が不足しているため、送信データやフローが正しい結果にならない可能性があります。',
    '',
    ...reasons.map((reason) => `・${reason}`),
  ].join('\n')
}

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

export interface UnassumedVariableLimitation {
  sourceName: string
  line: number
  name: string
}

export interface AnalysisLimitations {
  unassumedBranches: UnassumedBranchLimitation[]
  unassumedVariables: UnassumedVariableLimitation[]
  unlinkedIncludes: UnlinkedIncludeLimitation[]
}

export const EMPTY_ANALYSIS_LIMITATIONS: AnalysisLimitations = {
  unassumedBranches: [],
  unassumedVariables: [],
  unlinkedIncludes: [],
}

export function hasAnalysisLimitations(limitations: AnalysisLimitations): boolean {
  return (
    limitations.unassumedBranches.length > 0
    || limitations.unassumedVariables.length > 0
    || limitations.unlinkedIncludes.length > 0
  )
}

export function formatAnalysisLimitationWarning(limitations: AnalysisLimitations): string {
  const reasons: string[] = []
  if (limitations.unassumedBranches.length > 0) {
    reasons.push(`True/False 未選択の分岐: ${limitations.unassumedBranches.length} 件`)
  }
  if (limitations.unassumedVariables.length > 0) {
    reasons.push(`値が未仮定の変数: ${limitations.unassumedVariables.length} 件`)
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

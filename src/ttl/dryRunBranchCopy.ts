/** ドライラン分岐仮定ダイアログ・フローログ用のユーザー向け文言 */

export interface DryRunBranchDialogCopy {
  title: string
  lead: string
  trueLabel: string
  falseLabel: string
}

export function dryRunBranchDialogCopy(command: string): DryRunBranchDialogCopy {
  const cmd = command.toLowerCase()
  if (cmd === 'while') {
    return {
      title: 'while のループを選んでください',
      lead: '条件に含まれる変数の値は、この時点ではまだ分かりません。ドライランでは、ループに入るか続けるかを選びます。',
      trueLabel: '真（ループする）',
      falseLabel: '偽（ループしない）',
    }
  }
  if (cmd === 'until') {
    return {
      title: 'until の条件を選んでください',
      lead: '条件に含まれる変数の値は、この時点ではまだ分かりません。ドライランでは、ループを抜けるかどうかを選びます。',
      trueLabel: '真（ループを抜ける）',
      falseLabel: '偽（ループを続ける）',
    }
  }
  const label = cmd === 'elseif' ? 'elseif' : 'if'
  return {
    title: `${label} の分岐を選んでください`,
    lead: '条件に含まれる変数の値は、この時点ではまだ分かりません。ドライランでは、then 側に進むかを選びます。',
    trueLabel: '真（then に進む）',
    falseLabel: '偽（then をスキップ）',
  }
}

export function formatDryRunBranchFlowMessage(command: string, choice: boolean): string {
  const copy = dryRunBranchDialogCopy(command)
  return `分岐を仮定: ${choice ? copy.trueLabel : copy.falseLabel}`
}

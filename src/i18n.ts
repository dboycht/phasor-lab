/**
 * Bilingual UI strings (zh / en). Deliberately tiny: a flat dictionary plus a
 * `t()` lookup with `{name}` interpolation, and no external dependency.
 *
 * The LaTeX vocabulary stays the same in both languages - only the prose and
 * the labels change.
 */

export type Lang = 'zh' | 'en'

const STRINGS = {
  'app.title': { zh: '相量计算器', en: 'Phasor Calculator' },
  'app.subtitle': { zh: '电工相量/复数计算器', en: 'Phasor & complex calculator for circuit analysis' },

  'input.placeholder': {
    zh: '输入相量，例如 220\\angle 30\\degree 或 U=220\\angle 30\\degree\\text{V}',
    en: 'Type a phasor, e.g. 220\\angle 30\\degree or U=220\\angle 30\\degree\\text{V}',
  },
  'input.submit': { zh: '输入', en: 'Enter' },
  'input.clear': { zh: '清空全部', en: 'Clear all' },
  'input.help': { zh: '语法帮助', en: 'Syntax help' },
  'input.undo': { zh: '撤销 (Ctrl+Z)', en: 'Undo (Ctrl+Z)' },
  'input.redo': { zh: '重做 (Ctrl+Shift+Z)', en: 'Redo (Ctrl+Shift+Z)' },
  'input.export': { zh: '导出工程 (JSON)', en: 'Export project (JSON)' },
  'input.import': { zh: '导入工程 (JSON)', en: 'Import project (JSON)' },
  'input.editHint': { zh: '双击可再次编辑', en: 'Double-click to edit again' },
  'input.loaded': { zh: '工程已载入', en: 'Project loaded' },
  'input.loadFailed': { zh: '工程文件无法载入：{detail}', en: 'Cannot load that project: {detail}' },
  'input.imported': { zh: '已导入 {n} 个对象', en: 'Imported {n} objects' },
  'input.restored': { zh: '已恢复上次的工程', en: 'Restored your last project' },

  'keyboard.title': { zh: '电工符号', en: 'Symbols' },
  'keyboard.more': { zh: '更多', en: 'More' },

  'view.algebra': { zh: '代数区', en: 'Algebra' },
  'view.graphics': { zh: '图形区', en: 'Graphics' },
  'view.empty': { zh: '还没有定义任何相量', en: 'No phasors defined yet' },
  'view.emptyHint': { zh: '在上方输入框里输入第一个相量', en: 'Type your first phasor above' },

  'tool.fit': { zh: '适配', en: 'Fit' },
  'tool.zoomIn': { zh: '放大', en: 'Zoom in' },
  'tool.zoomOut': { zh: '缩小', en: 'Zoom out' },
  'tool.grid': { zh: '网格', en: 'Grid' },
  'tool.snap': { zh: '15° 吸附', en: 'Snap 15°' },
  'tool.labels': { zh: '标签', en: 'Labels' },
  'tool.png': { zh: '导出 PNG', en: 'Export PNG' },
  'tool.sum': { zh: '求和多边形', en: 'Sum polygon' },

  'settings.angleUnit': { zh: '角度单位', en: 'Angle unit' },
  'settings.deg': { zh: '度', en: 'Deg' },
  'settings.rad': { zh: '弧度', en: 'Rad' },
  'settings.convention': { zh: '相量约定', en: 'Convention' },
  'settings.rms': { zh: '有效值', en: 'RMS' },
  'settings.amplitude': { zh: '振幅', en: 'Amplitude' },
  'settings.precision': { zh: '有效数字', en: 'Digits' },
  'settings.convertAll': { zh: '换算全部', en: 'Convert all' },
  'settings.language': { zh: '语言', en: 'Language' },
  'settings.scaled': { zh: '已换算 ×{k}', en: 'converted ×{k}' },

  'result.title': { zh: '结果', en: 'Result' },
  'result.selected': { zh: '选中', en: 'Selected' },
  'result.magnitude': { zh: '模 |Z|', en: 'Modulus |Z|' },
  'result.argument': { zh: '辐角 arg', en: 'Argument' },
  'result.real': { zh: '实部', en: 'Real' },
  'result.imag': { zh: '虚部', en: 'Imaginary' },
  'result.conjugate': { zh: '共轭', en: 'Conjugate' },
  'result.rect': { zh: '代数形式', en: 'Rectangular' },
  'result.polar': { zh: '极坐标形式', en: 'Polar' },
  'result.exponential': { zh: '指数形式', en: 'Exponential' },
  'result.trig': { zh: '三角形式', en: 'Trigonometric' },
  'result.effective': { zh: '有效值', en: 'RMS value' },
  'result.peak': { zh: '振幅', en: 'Amplitude' },
  'result.none': { zh: '点击左侧对象查看详情，或直接输入表达式', en: 'Select an object on the left, or just type an expression' },
  'result.copy': { zh: '点击复制这一行', en: 'Click to copy this line' },
  'result.copied': { zh: '已复制到剪贴板', en: 'Copied to the clipboard' },
  'result.copyFailed': { zh: '复制失败，请手动选中', en: 'Could not copy; please select it manually' },

  'example.load': { zh: '载入示例…', en: 'Load an example…' },
  'compare.title': { zh: '双量对比', en: 'Compare two quantities' },
  'compare.a': { zh: '量 A', en: 'A' },
  'compare.b': { zh: '量 B', en: 'B' },
  'compare.pick': { zh: '（未选择）', en: '(none)' },
  'compare.hint': {
    zh: '选两个量即可对比：A/B 就是阻抗（A=电压、B=电流时），A·B̅ 就是复功率。',
    en: 'Pick two: A/B is the impedance when A is a voltage and B a current, and A\u00b7conj(B) is the complex power.',
  },
  'compare.bZero': { zh: 'B 为零，比值与相位差都没有意义。', en: 'B is zero, so neither a ratio nor a phase difference is defined.' },  'example.rlc': { zh: '串联 RLC（求电流）', en: 'Series RLC (find the current)' },
  'example.power': { zh: '功率与功率因数', en: 'Power and power factor' },
  'example.threePhase': { zh: '三相星形（线电压 √3 倍）', en: 'Three-phase star (√3 line voltage)' },
  'example.parallel': { zh: '并联阻抗', en: 'Parallel impedance' },
  'example.kvl': { zh: '串联回路 KVL（相量和）', en: 'Series loop KVL (phasor sum)' },

  'object.hide': { zh: '隐藏', en: 'Hide' },
  'object.show': { zh: '显示', en: 'Show' },
  'object.delete': { zh: '删除', en: 'Delete' },
  'object.error': { zh: '无法求值', en: 'Cannot evaluate' },

  'help.title': { zh: '语法速查', en: 'Syntax cheat sheet' },
  'help.polar': { zh: '极坐标：220\\angle 30\\degree 或 220\\angle 30', en: 'Polar: 220\\angle 30\\degree or 220\\angle 30' },
  'help.rect': { zh: '代数：3+4j', en: 'Rectangular: 3+4j' },
  'help.exp': { zh: '指数：220e^{j30\\degree}', en: 'Exponential: 220e^{j30\\degree}' },
  'help.trig': { zh: '三角：5(\\cos 53\\degree + j\\sin 53\\degree)', en: 'Trigonometric: 5(\\cos 53\\degree + j\\sin 53\\degree)' },
  'help.assign': { zh: '定义变量：U=220\\angle 0\\degree\\text{V}', en: 'Define: U=220\\angle 0\\degree\\text{V}' },
  'help.multi': { zh: '多语句用分号隔开：U=10;I=U/5', en: 'Separate statements with a semicolon: U=10;I=U/5' },
  'help.funcs': { zh: '函数：\\abs \\arg \\conj \\Re \\Im \\polar \\rms \\peak \\om', en: 'Functions: \\abs \\arg \\conj \\Re \\Im \\polar \\rms \\peak \\om' },
  'help.units': { zh: '角度：\\degree 恒为度；裸数字按当前角度单位', en: 'Angles: \\degree is always degrees; a bare number follows the angle unit' },
  'help.labels': { zh: '单位标签写在末尾：U=220\\angle 0\\degree\\text{V}（任意文字都行，不参与计算）', en: 'A trailing \\text{...} is a label: U=220\\angle 0\\degree\\text{V} (any text, never computed)' },
  'help.edit': { zh: '改一个数：双击对象行，改完回车覆盖它', en: 'Change one number: double-click the row, edit, press Enter' },
  'help.drag': { zh: '拖动箭头端点改值：Shift 只改角度、Alt 只改模、工具栏可开 15° 吸附', en: 'Drag an arrow tip to edit: Shift = angle only, Alt = magnitude only, 15 deg snap in the toolbar' },
  'help.view': { zh: '视图：滚轮缩放、拖空白平移、双击空白自适应', en: 'View: wheel to zoom, drag the background to pan, double-click to fit' },
  'help.history': { zh: '输入历史：输入框为空时按 ↑ 调出上一条，↓ 往回走', en: 'Input history: press Up in an empty box to recall, Down to go forward' },
  'help.copy': { zh: '复制结果：直接点结果卡里的那一行', en: 'Copy a result: click that line in the result card' },
  'help.compare': { zh: '双量对比：选中一个量，再在对比卡里选另一个 —— A/B 就是阻抗，A·B̅ 就是复功率', en: 'Compare two quantities: select one, pick the other in the compare card - A/B is the impedance, A*conj(B) the complex power' },
  'help.examples': { zh: '内置示例：代数区右上角「载入示例…」有四个经典电路', en: 'Worked examples: four classic circuits under "Load an example" in the algebra header' },
  'help.files': { zh: '不会丢：改动随时存进浏览器，也能导出/导入 JSON 工程文件', en: 'Nothing is lost: changes are saved in the browser, and projects export/import as JSON' },
  'help.undo': { zh: '撤销重做：Ctrl+Z / Ctrl+Shift+Z，或代数区左上角按钮', en: 'Undo/redo: Ctrl+Z and Ctrl+Shift+Z, or the buttons in the algebra header' },
  'help.close': { zh: '关闭', en: 'Close' },

  'status.ready': { zh: '就绪', en: 'Ready' },
  'status.ok': { zh: '已计算', en: 'Computed' },
  'status.drag': { zh: '拖动箭头端点可改值：Shift 只改角度 · Alt 只改模', en: 'Drag an arrow tip to edit: Shift = angle only, Alt = magnitude only' },

  'err.empty': { zh: '输入为空', en: 'Empty input' },
  'err.unknown-command': { zh: '不认识的命令 {detail}', en: 'Unknown command {detail}' },
  'err.unexpected-token': { zh: '多余的符号 {detail}', en: 'Unexpected symbol {detail}' },
  'err.missing-operand': { zh: '缺少操作数（{detail}）', en: 'Missing operand ({detail})' },
  'err.missing-right-operand': { zh: '角度符号右侧缺少数值', en: 'The angle sign needs a value on its right' },
  'err.chained-angle': { zh: '不能连续写两个角度符号', en: 'Two angle signs in a row' },
  'err.two-numbers': { zh: '两个数字相邻，缺少运算符：{detail}', en: 'Two numbers are adjacent; an operator is missing: {detail}' },
  'err.unclosed-brace': { zh: '括号没有闭合：{detail}', en: 'Unclosed bracket: {detail}' },
  'err.unclosed-pipe': { zh: '竖线没有闭合', en: 'Unclosed vertical bar' },
  'err.bad-assignment': { zh: '等号左边必须是单个变量名', en: 'The left of "=" must be a single variable name' },
  'err.eval': { zh: '无法求值：{detail}', en: 'Cannot evaluate: {detail}' },
} as const

export type StringKey = keyof typeof STRINGS

let current: Lang = detectLang()

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem('phasor-lab.lang')
    if (saved === 'zh' || saved === 'en') return saved
  } catch { /* storage may be unavailable */ }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en'
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  current = lang
  try { localStorage.setItem('phasor-lab.lang', lang) } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
}

export function t(key: StringKey, params?: Record<string, string | number>): string {
  const entry = STRINGS[key] as Record<Lang, string>
  let s = entry[current] ?? entry.en
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v))
  }
  return s
}

/** Turn a raw evaluator message into something a human wants to read. */
export function translateEvalError(message: string): string {
  const undefinedSymbol = /Undefined symbol (\S+)/.exec(message)
  if (undefinedSymbol) {
    return current === 'zh'
      ? `未定义的变量 ${undefinedSymbol[1]}`
      : `Undefined variable ${undefinedSymbol[1]}`
  }
  if (/not a number/.test(message)) {
    return current === 'zh' ? '结果不是数值' : 'The result is not a number'
  }
  if (/Unexpected type of argument/.test(message)) {
    return current === 'zh' ? '参数类型不对' : 'Wrong argument type'
  }
  if (/Division by zero/.test(message)) {
    return current === 'zh' ? '除数为零' : 'Division by zero'
  }
  return message
}

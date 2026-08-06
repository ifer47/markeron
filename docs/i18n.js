(function () {
  const STORAGE_KEY = 'markeron-lang';
  const SUPPORTED = ['en', 'zh-CN'];

  function kbdCombo(keys) {
    const keysHtml = keys
      .map((key, index) => {
        const plus = index > 0 ? '<span class="kbd-plus" aria-hidden="true">+</span>' : '';
        return `${plus}<kbd>${key}</kbd>`;
      })
      .join('');
    return `<span class="kbd-combo">${keysHtml}</span>`;
  }

  const enterCombo = kbdCombo(['Ctrl', 'Shift', 'D']);
  const enterComboMac = kbdCombo(['⌘', '⇧', 'D']);
  const clearCombo = kbdCombo(['Ctrl', 'Shift', 'C']);
  const clearComboMac = kbdCombo(['⌘', '⇧', 'C']);
  const clickThroughCombo = kbdCombo(['Ctrl', 'Shift', 'X']);
  const clickThroughComboMac = kbdCombo(['⌘', '⇧', 'X']);
  const undoCombo = kbdCombo(['Ctrl', 'Z']);
  const undoComboMac = kbdCombo(['⌘', 'Z']);
  const redoCombo = kbdCombo(['Ctrl', 'Shift', 'Z']);
  const redoComboMac = kbdCombo(['⌘', '⇧', 'Z']);
  const copyCombo = kbdCombo(['Ctrl', 'C']);
  const copyComboMac = kbdCombo(['⌘', 'C']);
  const confirmCombo = kbdCombo(['Ctrl', 'Enter']);
  const confirmComboMac = kbdCombo(['⌘', 'Return']);

  const messages = {
    en: {
      'meta.title': 'MarkerOn - Lightweight Screen Annotation Tool',
      'meta.description':
        'MarkerOn is a lightweight open-source screen annotation tool with click-through mode, whiteboard mode, and keyboard-first drawing for Windows and macOS.',
      'meta.keywords':
        'screen annotation tool, desktop drawing overlay, click-through annotation, desktop whiteboard, Tauri app, screen drawing',
      'meta.ogTitle': 'MarkerOn - Lightweight Screen Annotation Tool',
      'meta.ogDescription':
        'Draw, highlight, and annotate anywhere on your desktop. Click-through mode keeps annotations visible while you interact with apps below.',
      'helpPage.meta.title': 'MarkerOn Help & Shortcuts',
      'helpPage.meta.description':
        'MarkerOn keyboard shortcuts and help: global hotkeys, drawing tools, click-through mode, whiteboard, and modifier tips for Windows and macOS.',
      'helpPage.meta.keywords':
        'MarkerOn help, screen annotation shortcuts, click-through mode, whiteboard shortcuts, Ctrl+Shift+D, keyboard drawing',
      'helpPage.meta.ogTitle': 'MarkerOn Help & Shortcuts',
      'helpPage.meta.ogDescription':
        'Learn MarkerOn shortcuts: enter annotation, switch tools, toggle click-through, whiteboard, colors, and drag tips.',
      'skip': 'Skip to content',
      'nav.aria': 'Primary navigation',
      'nav.brandAria': 'MarkerOn home',
      'nav.linksAria': 'Product links',
      'nav.features': 'Features',
      'nav.help': 'Help',
      'nav.download': 'Download',
      'nav.faq': 'FAQ',
      'nav.sponsor': 'Sponsor',
      'nav.github': 'GitHub',
      'nav.langAria': 'Language',
      'nav.langEn': 'English',
      'nav.langZh': 'Chinese',
      'helpPage.eyebrow': 'Shortcuts reference',
      'helpPage.title': 'Help & shortcuts',
      'helpPage.lead':
        'Keyboard-first annotation for demos and teaching. Quick reference for global hotkeys, tools, modifiers, and click-through.',
      'helpPage.video': 'Prefer a walkthrough? Watch the Bilibili tutorial →',
      'helpPage.tocAria': 'On this page',
      'helpPage.toc.quick': 'Quick start',
      'helpPage.toc.global': 'Global',
      'helpPage.toc.tools': 'Tools',
      'helpPage.toc.draw': 'Draw & board',
      'helpPage.toc.tips': 'Tips',
      'helpPage.aside.aria': 'Essential shortcuts',
      'helpPage.aside.title': 'Cheat sheet',
      'helpPage.aside.sub': 'Top 4 essentials',
      'helpPage.aside.enter': 'Enter annotation',
      'helpPage.aside.enterKeys': enterCombo,
      'helpPage.aside.through': 'Click-through',
      'helpPage.aside.throughKeys': clickThroughCombo,
      'helpPage.aside.toolbar': 'Toolbar',
      'helpPage.aside.exit': 'Exit annotation',
      'helpPage.th.action': 'Action',
      'helpPage.th.windows': 'Windows',
      'helpPage.th.macos': 'macOS',
      'helpPage.quick.eyebrow': '01',
      'helpPage.quick.title': 'Quick start',
      'helpPage.quick.lead': 'From tray to first stroke in a few keys.',
      'helpPage.quick.step1Title': 'Launch',
      'helpPage.quick.step1Body':
        'MarkerOn runs in the system tray. Launching again while it is already running toggles annotation — same as clicking the tray icon.',
      'helpPage.quick.step2Title': 'Enter annotation',
      'helpPage.quick.step2Body': `Press ${enterCombo} (macOS: ${enterComboMac}) to draw over any app.`,
      'helpPage.quick.step3Title': 'Stay visible, keep working',
      'helpPage.quick.step3Body': `Press ${clickThroughCombo} for click-through so marks stay while you click below. <kbd>Esc</kbd> exits. <kbd>Space</kbd> opens the toolbar.`,
      'helpPage.global.eyebrow': '02',
      'helpPage.global.title': 'Global shortcuts',
      'helpPage.global.lead': 'Work from anywhere — even when the overlay is not active.',
      'helpPage.global.tableAria': 'Global shortcut table',
      'helpPage.global.toggle': 'Toggle annotation',
      'helpPage.global.toggleWin': enterCombo,
      'helpPage.global.toggleMac': enterComboMac,
      'helpPage.global.clear': 'Clear all annotations (undoable)',
      'helpPage.global.clearWin': clearCombo,
      'helpPage.global.clearMac': clearComboMac,
      'helpPage.global.through': 'Toggle click-through',
      'helpPage.global.throughWin': clickThroughCombo,
      'helpPage.global.throughMac': clickThroughComboMac,
      'helpPage.global.note':
        'While drawing, press <kbd>X</kbd> to toggle click-through, or <kbd>Esc</kbd> to exit annotation.',
      'helpPage.tools.eyebrow': '03',
      'helpPage.tools.title': 'In-session tools',
      'helpPage.tools.lead': 'Number keys and letter shortcuts switch tools. No menus required.',
      'helpPage.tools.pen': 'Pen',
      'helpPage.tools.penDesc': 'Freehand drawing with smooth curves',
      'helpPage.tools.highlighter': 'Highlighter',
      'helpPage.tools.highlighterDesc': 'Semi-transparent highlight',
      'helpPage.tools.arrow': 'Arrow',
      'helpPage.tools.arrowDesc': 'Arrow pointer line',
      'helpPage.tools.rect': 'Rectangle',
      'helpPage.tools.rectDesc': 'Rectangle outline',
      'helpPage.tools.ellipse': 'Ellipse',
      'helpPage.tools.ellipseDesc': 'Ellipse outline',
      'helpPage.tools.line': 'Line',
      'helpPage.tools.lineDesc': 'Straight line segment',
      'helpPage.tools.eraser': 'Eraser',
      'helpPage.tools.eraserDesc':
        'Separate width; press <kbd>7</kbd> again while selected to switch stroke / object erase (also in Settings → General)',
      'helpPage.tools.laser': 'Laser',
      'helpPage.tools.laserDesc': 'Temporary ink that fades from the oldest tip first',
      'helpPage.tools.text': 'Text',
      'helpPage.tools.textDesc': 'Double-click to place; scroll to resize',
      'helpPage.tools.stamp': 'Stamp',
      'helpPage.tools.stampDesc':
        'Click to place numbered or lettered markers; press <kbd>N</kbd> again to toggle; <kbd>Shift</kbd>+<kbd>N</kbd> resets the counter',
      'helpPage.session.tableAria': 'In-session edit shortcuts',
      'helpPage.session.toolbar': 'Toolbar',
      'helpPage.session.undo': 'Undo',
      'helpPage.session.undoKeys': `${undoCombo} <span class="help-key-sep" aria-hidden="true">/</span> ${undoComboMac}`,
      'helpPage.session.redo': 'Redo',
      'helpPage.session.redoKeys': `${redoCombo} <span class="help-key-sep" aria-hidden="true">/</span> ${redoComboMac}`,
      'helpPage.session.width': 'Stroke width',
      'helpPage.session.widthKeys': '<kbd>Ctrl</kbd> + scroll',
      'helpPage.session.copy': 'Copy screen',
      'helpPage.session.copyKeys': `${copyCombo} <span class="help-key-sep" aria-hidden="true">/</span> ${copyComboMac}`,
      'helpPage.session.widthHint':
        'Pen, laser, arrow, rectangle, ellipse, and line share one width; highlighter and eraser each have their own; text and stamp share one size group.',
      'helpPage.draw.eyebrow': '04',
      'helpPage.draw.title': 'Drawing modifiers, colors & whiteboard',
      'helpPage.draw.lead': 'Hold modifiers while dragging to snap shapes. Cycle colors without leaving the canvas.',
      'helpPage.draw.modifiersTitle': 'Modifier + drag',
      'helpPage.draw.line': 'Line',
      'helpPage.draw.lineKeys': '<kbd>Alt</kbd> / <kbd>⌥</kbd> + drag',
      'helpPage.draw.rect': 'Rectangle',
      'helpPage.draw.rectKeys': '<kbd>Ctrl</kbd> / <kbd>⌘</kbd> + drag',
      'helpPage.draw.square': 'Square',
      'helpPage.draw.squareKeys': '<kbd>Ctrl</kbd>+<kbd>Alt</kbd> / <kbd>⌘</kbd>+<kbd>⌥</kbd> + drag',
      'helpPage.draw.ellipse': 'Ellipse',
      'helpPage.draw.ellipseKeys': '<kbd>Shift</kbd> / <kbd>⇧</kbd> + drag',
      'helpPage.draw.circle': 'Circle',
      'helpPage.draw.circleKeys': '<kbd>Shift</kbd>+<kbd>Alt</kbd> / <kbd>⇧</kbd>+<kbd>⌥</kbd> + drag',
      'helpPage.draw.arrow': 'Arrow',
      'helpPage.draw.arrowKeys': '<kbd>Ctrl</kbd>+<kbd>Shift</kbd> / <kbd>⌘</kbd>+<kbd>⇧</kbd> + drag',
      'helpPage.draw.colorsTitle': 'Colors',
      'helpPage.draw.colorsPrevNext': 'Prev / next color',
      'helpPage.draw.colorsKeys': '<kbd>Q</kbd> / <kbd>E</kbd>',
      'helpPage.draw.rightClick': 'Hold to erase (release restores tool)',
      'helpPage.draw.rightClickKeys': 'Hold right-click',
      'helpPage.draw.boardTitle': 'Whiteboard',
      'helpPage.draw.boardToggle': 'Enter / exit',
      'helpPage.draw.boardCopy': 'Copy whiteboard',
      'helpPage.draw.boardCopyKeys': `${copyCombo} <span class="help-key-sep" aria-hidden="true">/</span> ${copyComboMac}`,
      'helpPage.draw.boardExit': 'Exit whiteboard',
      'helpPage.settings.eraserTitle': 'Eraser modes',
      'helpPage.settings.eraserBody':
        'Stroke: erase pixels along the drag path (undoable). Object: delete entire shapes or text when you pass over them (undoable). Element dragging is disabled while the eraser is selected, even with hover drag on. Switch in Settings → General, or press <kbd>7</kbd> again while the eraser is selected.',
      'helpPage.settings.boardTitle': 'Whiteboard & content',
      'helpPage.settings.boardBody':
        'Default entry chooses screen overlay or whiteboard. Keep after exit restores your last session when you re-enter. Keep on W toggle preserves drawings when switching modes without exiting; turn off to start with a blank whiteboard each time you press W. Configure these in Settings → General.',
      'helpPage.tips.eyebrow': '05',
      'helpPage.tips.title': 'Click-through & drag tips',
      'helpPage.tips.lead': 'Keep marks on screen while you present — then move or edit when needed.',
      'helpPage.tips.throughTitle': 'Click-through mode',
      'helpPage.tips.throughBody': `Toggle from the toolbar, with ${clickThroughCombo} (global), or <kbd>X</kbd> while drawing. Marks stay visible; clicks reach the app below.`,
      'helpPage.tips.dragTitle': 'Drag elements',
      'helpPage.tips.dragBody':
        'In General settings: off, hover to drag, or hold Ctrl/Command to drag. Disabled while eraser is selected.',
      'helpPage.tips.textTitle': 'Edit text',
      'helpPage.tips.textBody': `Double-click text to re-edit; in <kbd>T</kbd> mode, double-click empty area to create. Confirm with ${confirmCombo} (macOS: ${confirmComboMac}) or double right-click.`,
      'helpPage.tips.toolbarTitle': 'Toolbar',
      'helpPage.tips.toolbarBody':
        'Press Space for the floating toolbar. Panel actions keep it open; canvas actions collapse it. Pin to stay visible. Pen / pointer switch drawing and click-through.',
      'helpPage.cta.copy': 'Ready to annotate? Download MarkerOn and start with the tray shortcut.',
      'helpPage.cta.download': 'Download Latest',
      'helpPage.cta.home': 'Back to home',
      'bottom.helpLink': 'Full shortcuts & help',
      'bottom.helpLinkDesc': 'Tools, modifiers, whiteboard, and click-through tips.',
      'hero.eyebrow': 'Open source / Tauri v2 / ~1.5\u00a0MB',
      'hero.copy':
        'A keyboard-first screen annotation tool for demos, teaching, meetings, and recordings. Draw over any app, then switch to click-through mode while your marks stay visible.',
      'hero.downloadAria': 'Download actions',
      'hero.downloadLatest': 'Download Latest',
      'hero.msStore': 'Microsoft Store',
      'hero.chipsAria': 'Core capabilities',
      'hero.chip.tools': 'Keyboard-first drawing tools',
      'hero.chip.clickThrough': 'Click-through mode',
      'hero.chip.whiteboard': 'Whiteboard mode',
      'hero.chip.platforms': 'Win / macOS',
      'hero.quickStartAria': 'Quick start',
      'hero.quickStartTitle': 'Quick Start',
      'hero.quickStep1Keys': enterCombo,
      'hero.quickStep1Desc': 'Enter annotation',
      'hero.quickStep2Keys': clickThroughCombo,
      'hero.quickStep2Desc': 'Click through',
      'hero.quickStep3Keys': '<kbd>Esc</kbd>',
      'hero.quickStep3Desc': 'Exit',
      'hero.quickStep4Keys': '<kbd>Space</kbd>',
      'hero.quickStep4Desc': 'Toolbar',
      'proof.aria': 'Why MarkerOn',
      'proof.instantTitle': 'Instant',
      'proof.instantBody': `Press ${enterCombo} and start drawing over any app.`,
      'proof.unintrusiveTitle': 'Unintrusive',
      'proof.unintrusiveBody': 'Runs in the tray — no account, telemetry, or cloud dependency.',
      'proof.preciseTitle': 'Precise',
      'proof.preciseBody': 'Shortcuts, angle snapping, custom widths, undo/redo — no menus required.',
      'features.eyebrow': 'Built for live explanation',
      'features.title': 'Keep the screen moving while your marks stay put.',
      'features.clickThroughTitle': 'Click-through mode',
      'features.clickThroughBody': `Toggle from the toolbar or with ${clickThroughCombo}. Annotations stay visible while clicks, scrolls, and typing reach the app underneath.`,
      'features.keyboardTitle': 'Keyboard-first tools',
      'features.keyboardBody':
        'Number keys switch tools. <kbd>Ctrl</kbd>+scroll adjusts width. <kbd>Q</kbd>/<kbd>E</kbd> cycle colors. Copy and clear without opening menus.',
      'features.whiteboardTitle': 'Whiteboard when needed',
      'features.whiteboardBody':
        'Press <kbd>W</kbd> for a clean board, keep content between sessions, and copy as an image for docs or chats.',
      'showcase.surfaceEyebrow': 'Product surface',
      'showcase.toolsTitle': 'Annotation tools',
      'showcase.toolsAlt': 'MarkerOn annotation tools',
      'showcase.toolsCaption': 'Pen, highlighter, laser, arrow, shapes, eraser, text, stamp, and colors.',
      'showcase.settingsTitle': 'Settings panel',
      'showcase.settingsAlt': 'MarkerOn settings panel',
      'showcase.settingsCaption': 'Toolbar, whiteboard, drag modes, shortcuts, and startup.',
      'showcase.demoEyebrow': 'Live demo',
      'showcase.demoTitle': 'Click-through mode',
      'showcase.demoAlt':
        'Click-through demo: draw on screen, press Ctrl+Shift+X, then select text in the app below while annotations remain visible',
      'showcase.demoCaption': `Draw, press ${clickThroughCombo}, then keep working underneath.`,
      'shortcuts.aria': 'Essential shortcuts',
      'shortcuts.enter': 'Enter',
      'shortcuts.toolbar': 'Toolbar',
      'shortcuts.through': 'Through',
      'shortcuts.throughKeys': clickThroughCombo,
      'shortcuts.board': 'Board',
      'bottom.eyebrow': 'Get started',
      'bottom.title': 'Download MarkerOn or read the FAQ.',
      'bottom.lead': 'Official installers and quick answers when comparing screen annotation tools.',
      'bottom.downloadLabel': 'Official downloads',
      'bottom.faqLabel': 'Common questions',
      'bottom.githubTitle': 'GitHub Releases',
      'bottom.githubDesc': 'Windows / macOS installers and Windows portable zip',
      'bottom.storeTitle': 'Microsoft Store',
      'bottom.storeDesc': 'Windows install and updates',
      'bottom.portableTitle': 'Windows portable',
      'bottom.portableDesc': 'Extract and run — config stays in data\\ next to the exe',
      'bottom.sourceTitle': 'Source Code',
      'bottom.sourceDesc': 'MIT licensed on GitHub',
      'bottom.faq1Title': 'What is MarkerOn for?',
      'bottom.faq1Desc':
        'Live screen annotation for demos, teaching, and meetings — keyboard-first tools and click-through mode built in.',
      'bottom.faq2Title': 'How does click-through mode work?',
      'bottom.faq2Desc': `Toggle from the toolbar or with ${clickThroughCombo}. Marks stay visible while you click, scroll, and type in apps below.`,
      'bottom.faq3Title': 'Account or cloud upload?',
      'bottom.faq3Desc': 'No. Local-first, open source, and account-free.',
      'footer.license':
        '<a href="https://github.com/ifer47/markeron" translate="no">MarkerOn</a> is open source under the MIT License.',
      'footer.sponsor': 'Support development',
      'footer.feedback': 'Feedback and issues',
    },
    'zh-CN': {
      'meta.title': 'MarkerOn - 轻量级屏幕标注工具',
      'meta.description':
        'MarkerOn 是一款轻量级开源屏幕标注工具，支持穿透模式、白板模式与快捷键优先绘制，适用于 Windows 和 macOS。',
      'meta.keywords':
        '屏幕标注工具, 桌面标注, 穿透模式, 桌面白板, Tauri 应用, 屏幕绘画',
      'meta.ogTitle': 'MarkerOn - 轻量级屏幕标注工具',
      'meta.ogDescription':
        '在桌面任意位置绘画、高亮与标注。穿透模式下标注保持可见，同时可操作下层应用。',
      'helpPage.meta.title': 'MarkerOn 帮助与快捷键',
      'helpPage.meta.description':
        'MarkerOn 快捷键与使用帮助：全局热键、绘画工具、穿透模式、白板与修饰键提示，适用于 Windows 和 macOS。',
      'helpPage.meta.keywords':
        'MarkerOn 帮助, 屏幕标注快捷键, 穿透模式, 白板快捷键, Ctrl+Shift+D, 键盘绘画',
      'helpPage.meta.ogTitle': 'MarkerOn 帮助与快捷键',
      'helpPage.meta.ogDescription':
        '查阅 MarkerOn 快捷键：进入标注、切换工具、穿透模式、白板、颜色与拖拽技巧。',
      'skip': '跳到主要内容',
      'nav.aria': '主导航',
      'nav.brandAria': 'MarkerOn 首页',
      'nav.linksAria': '产品链接',
      'nav.features': '功能',
      'nav.help': '帮助',
      'nav.download': '下载',
      'nav.faq': '常见问题',
      'nav.sponsor': '赞助',
      'nav.github': 'GitHub',
      'nav.langAria': '语言',
      'nav.langEn': '英语',
      'nav.langZh': '中文',
      'helpPage.eyebrow': '快捷键速查',
      'helpPage.title': '帮助与快捷键',
      'helpPage.lead':
        '面向演示与教学的快捷键优先标注。本页速查全局热键、工具、修饰键与穿透模式。',
      'helpPage.video': '更想看演示？观看 B 站使用教程 →',
      'helpPage.tocAria': '本页目录',
      'helpPage.toc.quick': '快速开始',
      'helpPage.toc.global': '全局',
      'helpPage.toc.tools': '工具',
      'helpPage.toc.draw': '绘制与白板',
      'helpPage.toc.tips': '技巧',
      'helpPage.aside.aria': '常用快捷键',
      'helpPage.aside.title': '速查卡',
      'helpPage.aside.sub': '最常用 4 个',
      'helpPage.aside.enter': '进入标注',
      'helpPage.aside.enterKeys': enterCombo,
      'helpPage.aside.through': '穿透模式',
      'helpPage.aside.throughKeys': clickThroughCombo,
      'helpPage.aside.toolbar': '工具栏',
      'helpPage.aside.exit': '退出标注',
      'helpPage.th.action': '功能',
      'helpPage.th.windows': 'Windows',
      'helpPage.th.macos': 'macOS',
      'helpPage.quick.eyebrow': '01',
      'helpPage.quick.title': '快速开始',
      'helpPage.quick.lead': '从托盘到第一笔，只需几个按键。',
      'helpPage.quick.step1Title': '启动',
      'helpPage.quick.step1Body':
        'MarkerOn 在系统托盘运行。应用已在后台时再次启动会切换标注 — 与点击托盘图标相同。',
      'helpPage.quick.step2Title': '进入标注',
      'helpPage.quick.step2Body': `按 ${enterCombo}（macOS：${enterComboMac}）即可在任意应用上方绘画。`,
      'helpPage.quick.step3Title': '标注可见，继续操作',
      'helpPage.quick.step3Body': `按 ${clickThroughCombo} 进入穿透模式，标注保持可见并可点击下层。<kbd>Esc</kbd> 退出。<kbd>Space</kbd> 呼出工具栏。`,
      'helpPage.global.eyebrow': '02',
      'helpPage.global.title': '全局快捷键',
      'helpPage.global.lead': '随时可用 — 即使叠加层未激活。',
      'helpPage.global.tableAria': '全局快捷键表',
      'helpPage.global.toggle': '开启 / 退出标注',
      'helpPage.global.toggleWin': enterCombo,
      'helpPage.global.toggleMac': enterComboMac,
      'helpPage.global.clear': '清除所有标注（可撤销）',
      'helpPage.global.clearWin': clearCombo,
      'helpPage.global.clearMac': clearComboMac,
      'helpPage.global.through': '切换穿透模式',
      'helpPage.global.throughWin': clickThroughCombo,
      'helpPage.global.throughMac': clickThroughComboMac,
      'helpPage.global.note':
        '绘制中可按 <kbd>X</kbd> 切换穿透，或按 <kbd>Esc</kbd> 退出标注。',
      'helpPage.tools.eyebrow': '03',
      'helpPage.tools.title': '标注模式内工具',
      'helpPage.tools.lead': '数字键与字母快捷键切换工具，无需打开菜单。',
      'helpPage.tools.pen': '画笔',
      'helpPage.tools.penDesc': '自由绘画，贝塞尔曲线平滑',
      'helpPage.tools.highlighter': '荧光笔',
      'helpPage.tools.highlighterDesc': '半透明高亮标记',
      'helpPage.tools.arrow': '箭头',
      'helpPage.tools.arrowDesc': '带箭头指示线',
      'helpPage.tools.rect': '矩形',
      'helpPage.tools.rectDesc': '矩形边框',
      'helpPage.tools.ellipse': '椭圆',
      'helpPage.tools.ellipseDesc': '椭圆边框',
      'helpPage.tools.line': '直线',
      'helpPage.tools.lineDesc': '直线段',
      'helpPage.tools.eraser': '橡皮擦',
      'helpPage.tools.eraserDesc':
        '独立线宽；选中后再按 <kbd>7</kbd> 切换轨迹 / 对象擦除（也可在「设置 → 常规」中切换）',
      'helpPage.tools.laser': '激光笔',
      'helpPage.tools.laserDesc': '临时笔迹，先画的部分先淡出',
      'helpPage.tools.text': '文字',
      'helpPage.tools.textDesc': '双击放置，滚轮调字号',
      'helpPage.tools.stamp': '序号',
      'helpPage.tools.stampDesc':
        '单击放置数字或字母标记；再按 <kbd>N</kbd> 切换数字/字母；<kbd>Shift</kbd>+<kbd>N</kbd> 重置计数',
      'helpPage.session.tableAria': '标注模式内编辑快捷键',
      'helpPage.session.toolbar': '工具栏',
      'helpPage.session.undo': '撤销',
      'helpPage.session.undoKeys': `${undoCombo} <span class="help-key-sep" aria-hidden="true">/</span> ${undoComboMac}`,
      'helpPage.session.redo': '重做',
      'helpPage.session.redoKeys': `${redoCombo} <span class="help-key-sep" aria-hidden="true">/</span> ${redoComboMac}`,
      'helpPage.session.width': '调整线宽',
      'helpPage.session.widthKeys': '<kbd>Ctrl</kbd> + 滚轮',
      'helpPage.session.copy': '复制屏幕',
      'helpPage.session.copyKeys': `${copyCombo} <span class="help-key-sep" aria-hidden="true">/</span> ${copyComboMac}`,
      'helpPage.session.widthHint':
        '画笔、激光笔与箭头 / 矩形 / 椭圆 / 直线共用粗细；荧光笔、橡皮擦各自独立；文字与序号共用字号组。',
      'helpPage.draw.eyebrow': '04',
      'helpPage.draw.title': '绘制修饰键、颜色与白板',
      'helpPage.draw.lead': '拖动时按住修饰键吸附形状；无需离开画布即可切换颜色。',
      'helpPage.draw.modifiersTitle': '修饰键 + 拖动',
      'helpPage.draw.line': '直线',
      'helpPage.draw.lineKeys': '<kbd>Alt</kbd> / <kbd>⌥</kbd> + 拖动',
      'helpPage.draw.rect': '矩形',
      'helpPage.draw.rectKeys': '<kbd>Ctrl</kbd> / <kbd>⌘</kbd> + 拖动',
      'helpPage.draw.square': '正方形',
      'helpPage.draw.squareKeys': '<kbd>Ctrl</kbd>+<kbd>Alt</kbd> / <kbd>⌘</kbd>+<kbd>⌥</kbd> + 拖动',
      'helpPage.draw.ellipse': '椭圆',
      'helpPage.draw.ellipseKeys': '<kbd>Shift</kbd> / <kbd>⇧</kbd> + 拖动',
      'helpPage.draw.circle': '正圆',
      'helpPage.draw.circleKeys': '<kbd>Shift</kbd>+<kbd>Alt</kbd> / <kbd>⇧</kbd>+<kbd>⌥</kbd> + 拖动',
      'helpPage.draw.arrow': '箭头',
      'helpPage.draw.arrowKeys': '<kbd>Ctrl</kbd>+<kbd>Shift</kbd> / <kbd>⌘</kbd>+<kbd>⇧</kbd> + 拖动',
      'helpPage.draw.colorsTitle': '颜色',
      'helpPage.draw.colorsPrevNext': '上一个 / 下一个颜色',
      'helpPage.draw.colorsKeys': '<kbd>Q</kbd> / <kbd>E</kbd>',
      'helpPage.draw.rightClick': '按住擦除（松开恢复原工具）',
      'helpPage.draw.rightClickKeys': '按住右键',
      'helpPage.draw.boardTitle': '白板',
      'helpPage.draw.boardToggle': '进入 / 退出',
      'helpPage.draw.boardCopy': '复制白板',
      'helpPage.draw.boardCopyKeys': `${copyCombo} <span class="help-key-sep" aria-hidden="true">/</span> ${copyComboMac}`,
      'helpPage.draw.boardExit': '退出白板',
      'helpPage.settings.eraserTitle': '橡皮擦模式',
      'helpPage.settings.eraserBody':
        '轨迹擦除：按路径局部擦除像素（可撤销）。对象擦除：划过图形或文字时删除整个元素（可撤销）。使用橡皮擦时不会触发元素拖拽，即使已开启悬停拖动。可在「设置 → 常规」中切换，或在已选中橡皮擦时再按 <kbd>7</kbd>。',
      'helpPage.settings.boardTitle': '白板与内容',
      'helpPage.settings.boardBody':
        '默认进入选择屏幕叠加或白底画布。退出标注后保留：再次进入时恢复上次内容。按 W 切换时保留：在标注模式内切换屏幕/白板时不重置画布；关闭后每次按 W 进入白板均为空白画布。可在「设置 → 常规」中配置。',
      'helpPage.tips.eyebrow': '05',
      'helpPage.tips.title': '穿透与拖拽技巧',
      'helpPage.tips.lead': '演示时让标注留在屏幕上 — 需要时再移动或编辑。',
      'helpPage.tips.throughTitle': '穿透模式',
      'helpPage.tips.throughBody': `在工具栏切换，或按 ${clickThroughCombo}（全局）、绘制中按 <kbd>X</kbd>。标注保持可见，点击可到达下层应用。`,
      'helpPage.tips.dragTitle': '拖拽元素',
      'helpPage.tips.dragBody':
        '「常规」中可选：关闭、悬停拖动，或按住 Ctrl/Command 拖动。选中橡皮擦时不触发。',
      'helpPage.tips.textTitle': '编辑文字',
      'helpPage.tips.textBody': `双击文字可重新编辑；<kbd>T</kbd> 模式下双击空白处新建。确认用 ${confirmCombo}（macOS：${confirmComboMac}），或双击右键。`,
      'helpPage.tips.toolbarTitle': '工具栏',
      'helpPage.tips.toolbarBody':
        '按 Space 呼出浮动工具栏。面板内操作保持打开，画布操作后收起；可图钉固定。画笔 / 指针切换绘制与穿透。',
      'helpPage.cta.copy': '准备好标注了？下载 MarkerOn，用托盘快捷键开始。',
      'helpPage.cta.download': '下载最新版',
      'helpPage.cta.home': '返回首页',
      'bottom.helpLink': '完整快捷键与帮助',
      'bottom.helpLinkDesc': '工具、修饰键、白板与穿透模式技巧。',
      'hero.eyebrow': '开源 / Tauri v2 / 约 1.5 MB',
      'hero.copy':
        '面向演示、教学、会议与录屏的快捷键优先屏幕标注工具。可在任意应用上方绘画，并切换到穿透模式，标注保持可见。',
      'hero.downloadAria': '下载操作',
      'hero.downloadLatest': '下载最新版',
      'hero.msStore': '微软商店',
      'hero.chipsAria': '核心能力',
      'hero.chip.tools': '快捷键优先工具集',
      'hero.chip.clickThrough': '穿透模式',
      'hero.chip.whiteboard': '白板模式',
      'hero.chip.platforms': 'Win / macOS',
      'hero.quickStartAria': '快速开始',
      'hero.quickStartTitle': '快速开始',
      'hero.quickStep1Keys': enterCombo,
      'hero.quickStep1Desc': '进入标注',
      'hero.quickStep2Keys': clickThroughCombo,
      'hero.quickStep2Desc': '穿透操作',
      'hero.quickStep3Keys': '<kbd>Esc</kbd>',
      'hero.quickStep3Desc': '退出',
      'hero.quickStep4Keys': '<kbd>Space</kbd>',
      'hero.quickStep4Desc': '呼出工具栏',
      'proof.aria': '为什么选择 MarkerOn',
      'proof.instantTitle': '即开即用',
      'proof.instantBody': `按 ${enterCombo}，即可在任意应用上方开始标注。`,
      'proof.unintrusiveTitle': '轻量无扰',
      'proof.unintrusiveBody': '托盘常驻 — 无需账号、遥测或云端依赖。',
      'proof.preciseTitle': '精准高效',
      'proof.preciseBody': '快捷键、角度吸附、自定义线宽、撤销重做 — 无需打开菜单。',
      'features.eyebrow': '为现场讲解而生',
      'features.title': '屏幕继续操作，标注留在原地。',
      'features.clickThroughTitle': '穿透模式',
      'features.clickThroughBody': `在工具栏或按 ${clickThroughCombo} 切换。标注保持可见，点击、滚动与输入可到达下层应用。`,
      'features.keyboardTitle': '快捷键优先',
      'features.keyboardBody':
        '数字键切换工具。<kbd>Ctrl</kbd>+滚轮调整线宽。<kbd>Q</kbd>/<kbd>E</kbd> 切换颜色。复制与清空无需打开菜单。',
      'features.whiteboardTitle': '需要时使用白板',
      'features.whiteboardBody':
        '按 <kbd>W</kbd> 打开干净白板，内容可跨会话保留，并复制为图片用于文档或聊天。',
      'showcase.surfaceEyebrow': '产品界面',
      'showcase.toolsTitle': '标注工具',
      'showcase.toolsAlt': 'MarkerOn 标注工具',
      'showcase.toolsCaption': '画笔、荧光笔、激光笔、箭头、形状、橡皮擦、文字、序号与颜色。',
      'showcase.settingsTitle': '设置面板',
      'showcase.settingsAlt': 'MarkerOn 设置面板',
      'showcase.settingsCaption': '工具栏、白板、拖拽模式、快捷键与启动项。',
      'showcase.demoEyebrow': '动态演示',
      'showcase.demoTitle': '穿透模式',
      'showcase.demoAlt': '穿透模式演示：在屏幕上绘画，按 Ctrl+Shift+X 后可在保留标注的同时操作下层应用',
      'showcase.demoCaption': `绘画后按 ${clickThroughCombo}，继续操作下层内容。`,
      'shortcuts.aria': '常用快捷键',
      'shortcuts.enter': '进入',
      'shortcuts.toolbar': '工具栏',
      'shortcuts.through': '穿透',
      'shortcuts.throughKeys': clickThroughCombo,
      'shortcuts.board': '白板',
      'bottom.eyebrow': '开始使用',
      'bottom.title': '下载 MarkerOn 或查看常见问题。',
      'bottom.lead': '官方安装包与对比屏幕标注工具时的快速解答。',
      'bottom.downloadLabel': '官方下载',
      'bottom.faqLabel': '常见问题',
      'bottom.githubTitle': 'GitHub Releases',
      'bottom.githubDesc': 'Windows / macOS 安装包与 Windows 绿色版 zip',
      'bottom.storeTitle': '微软商店',
      'bottom.storeDesc': 'Windows 安装与更新',
      'bottom.portableTitle': 'Windows 绿色版',
      'bottom.portableDesc': '解压即用，配置保存在程序旁 data\\ 目录',
      'bottom.sourceTitle': '源代码',
      'bottom.sourceDesc': 'GitHub 开源，MIT 协议',
      'bottom.faq1Title': 'MarkerOn 适合什么场景？',
      'bottom.faq1Desc': '演示、教学、会议与录屏时的屏幕标注，内置快捷键工具与穿透模式。',
      'bottom.faq2Title': '穿透模式怎么用？',
      'bottom.faq2Desc': `在工具栏切换，或按 ${clickThroughCombo}。标注保持可见，同时可点击、滚动并在下层应用中输入。`,
      'bottom.faq3Title': '需要账号或上传截图吗？',
      'bottom.faq3Desc': '不需要。本地优先、开源、无需账号。',
      'footer.license':
        '<a href="https://github.com/ifer47/markeron" translate="no">MarkerOn</a> 基于 MIT 协议开源。',
      'footer.sponsor': '赞助开发',
      'footer.feedback': '反馈与 Issue',
    },
  };

  function normalizeLocale(locale) {
    if (!locale) return 'en';
    if (locale === 'zh' || locale.startsWith('zh-')) return 'zh-CN';
    return SUPPORTED.includes(locale) ? locale : 'en';
  }

  function detectLocale() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('lang');
    if (fromQuery) return normalizeLocale(fromQuery);

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeLocale(stored);

    return normalizeLocale(navigator.language || 'en');
  }

  function t(locale, key) {
    return messages[locale]?.[key] ?? messages.en[key] ?? '';
  }

  function setMeta(name, content, attr) {
    const selector = attr === 'property' ? `meta[property="${name}"]` : `meta[name="${name}"]`;
    const node = document.querySelector(selector);
    if (node) node.setAttribute('content', content);
  }

  function applyTextNodes(locale) {
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      const key = node.getAttribute('data-i18n');
      node.textContent = t(locale, key);
    });
  }

  function applyHtmlNodes(locale) {
    document.querySelectorAll('[data-i18n-html]').forEach((node) => {
      const key = node.getAttribute('data-i18n-html');
      node.innerHTML = t(locale, key);
    });
  }

  function applyAriaNodes(locale) {
    document.querySelectorAll('[data-i18n-aria]').forEach((node) => {
      const key = node.getAttribute('data-i18n-aria');
      node.setAttribute('aria-label', t(locale, key));
    });
  }

  function applyAltNodes(locale) {
    document.querySelectorAll('[data-i18n-alt]').forEach((node) => {
      const key = node.getAttribute('data-i18n-alt');
      node.setAttribute('alt', t(locale, key));
    });
  }

  function updateLangSwitcher(locale) {
    document.querySelectorAll('[data-lang]').forEach((button) => {
      const active = button.getAttribute('data-lang') === locale;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function applyLocale(locale) {
    const normalized = normalizeLocale(locale);
    document.documentElement.lang = normalized === 'zh-CN' ? 'zh-CN' : 'en';
    document.documentElement.dataset.locale = normalized;

    const metaPrefix = document.body?.dataset?.page === 'help' ? 'helpPage.meta' : 'meta';
    document.title = t(normalized, `${metaPrefix}.title`);
    setMeta('description', t(normalized, `${metaPrefix}.description`));
    setMeta('keywords', t(normalized, `${metaPrefix}.keywords`));
    setMeta('og:title', t(normalized, `${metaPrefix}.ogTitle`), 'property');
    setMeta('og:description', t(normalized, `${metaPrefix}.ogDescription`), 'property');

    applyTextNodes(normalized);
    applyHtmlNodes(normalized);
    applyAriaNodes(normalized);
    applyAltNodes(normalized);
    updateLangSwitcher(normalized);

    localStorage.setItem(STORAGE_KEY, normalized);
  }

  function init() {
    const locale = detectLocale();
    applyLocale(locale);

    document.querySelectorAll('[data-lang]').forEach((button) => {
      button.addEventListener('click', () => {
        applyLocale(button.getAttribute('data-lang'));
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

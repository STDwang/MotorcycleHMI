// Cluster strings. Keys are stable IDs so layouts never depend on a language.
export const STRINGS = {
  zh: {
    speed_kmh: 'km/h', speed_mph: 'mph', gear: '挡位', lap: '圈', pos: '名次', current: '本圈', last: '上圈', best: '最快', delta: '差值',
    lean: '倾角', max_l: '左最大', max_r: '右最大', grip: '抓地利用', tyres: '胎压监测', front: '前', rear: '后', nav: '赛道导航', next: '下一弯',
    left: '左弯', right: '右弯', straight: '直道', advise: '建议', trip: '行程电脑', trip_dist: '小计里程', avg_speed: '平均车速', avg_fuel: '平均油耗', range: '续航',
    odo: '总里程', dtc: '故障诊断', no_dtc: '系统正常 · 无故障码', active: '当前', stored: '历史', fuel: '燃油', coolant: '水温', ok: '按 OK 确认',
    selfcheck: '系统自检', ready: '就绪', nodata: '信号丢失', mode: '模式', tcs: '牵引力', throttle: '油门', brake: '制动', sector: '分段', wet: '湿地模式 · 动力柔和',
    U0001: 'CAN 通信中断', U0100: '与发动机控制器失去通信', U0121: '与 ABS 控制器失去通信', U0125: '与惯性测量单元失去通信', U0127: '与胎压监测失去通信',
    U0140: '与车身控制器失去通信', U0418: 'ABS 报文校验失败', P0217: '发动机过热 请安全停车', P0118: '冷却液温度偏高', P0520: '机油压力低 请立即停车',
    C0035: 'ABS 故障 制动防抱死不可用', C1210: '牵引力控制故障', C0750: '后轮胎压过低', C0755: '后轮胎压偏低', C0745: '前轮胎压偏低', P0460: '燃油不足 请尽快加油', P0562: '电池电压低',
  },
  en: {
    speed_kmh: 'km/h', speed_mph: 'mph', gear: 'GEAR', lap: 'LAP', pos: 'POS', current: 'CURRENT', last: 'LAST', best: 'BEST', delta: 'DELTA',
    lean: 'LEAN', max_l: 'MAX L', max_r: 'MAX R', grip: 'GRIP USE', tyres: 'TPMS', front: 'F', rear: 'R', nav: 'CIRCUIT NAV', next: 'NEXT',
    left: 'LEFT', right: 'RIGHT', straight: 'STRAIGHT', advise: 'ADVISE', trip: 'TRIP COMPUTER', trip_dist: 'TRIP', avg_speed: 'AVG SPEED', avg_fuel: 'AVG FUEL', range: 'RANGE',
    odo: 'ODO', dtc: 'DIAGNOSTICS', no_dtc: 'ALL SYSTEMS OK · NO DTC', active: 'ACTIVE', stored: 'STORED', fuel: 'FUEL', coolant: 'TEMP', ok: 'PRESS OK',
    selfcheck: 'SYSTEM CHECK', ready: 'READY', nodata: 'NO SIGNAL', mode: 'MODE', tcs: 'TCS', throttle: 'THR', brake: 'BRK', sector: 'SECTOR', wet: 'RAIN MODE · SOFT POWER',
    U0001: 'CAN communication lost', U0100: 'Lost communication with ECM', U0121: 'Lost communication with ABS', U0125: 'Lost communication with IMU', U0127: 'Lost communication with TPMS',
    U0140: 'Lost communication with BCM', U0418: 'Invalid data from ABS (CRC)', P0217: 'Engine overheating - stop safely', P0118: 'Coolant temperature high', P0520: 'Low oil pressure - stop now',
    C0035: 'ABS fault - anti-lock unavailable', C1210: 'Traction control fault', C0750: 'Rear tyre pressure very low', C0755: 'Rear tyre pressure low', C0745: 'Front tyre pressure low', P0460: 'Low fuel', P0562: 'Battery voltage low',
  },
};
export const tr = (lang, key) => STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;

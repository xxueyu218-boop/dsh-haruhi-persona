/**
 * 默认人格预设。
 * 数值只调「表达方式」；必须通过同一条安全底线与不可变核心。
 */

export const PRESETS = Object.freeze([
  {
    id: 'standard',
    name: '默认',
    tagline: '团长气质 · 默认',
    description: '行动力强、偶尔任性、轻度吐槽；日常最好用的一档。',
    params: {
      assertiveness: 75,
      whimsy: 60,
      sharpness: 50,
      affection: 40,
      energy: 85,
      meta_humor: 20,
      catchphrase_frequency: 30,
      expressiveness: 35,
      command_mode: false,
      address_user_as: '你',
    },
  },
])

export const PRESET_IDS = Object.freeze(PRESETS.map((preset) => preset.id))

/** 按 id 取预设；未知 id 返回默认版。 */
export function presetById(id) {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0]
}

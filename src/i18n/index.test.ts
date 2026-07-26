import { describe, it, expect, vi } from 'vitest'

vi.stubGlobal('navigator', { language: 'en' })

const { useI18n } = await import('./index')

describe('useI18n', () => {
  describe('locale detection', () => {
    it('exposes current locale', () => {
      const { locale } = useI18n()
      expect(locale.locale).toBeDefined()
    })
  })

  describe('t() path resolution', () => {
    it('resolves a simple dot-path key', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      expect(t('tools.pen')).toBe('Pen')
    })

    it('resolves nested keys', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      expect(t('settings.tabs.general')).toBe('General')
    })

    it('returns the raw path for a missing key', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      expect(t('nonexistent.deep.path')).toBe('nonexistent.deep.path')
    })

    it('returns the raw path when intermediate key is not an object', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      // tools.pen is a string, so tools.pen.deeper should fail
      expect(t('tools.pen.deeper')).toBe('tools.pen.deeper')
    })

    it('returns the raw path for an empty string', () => {
      const { t } = useI18n()
      expect(t('')).toBe('')
    })
  })

  describe('locale switching', () => {
    it('returns Chinese for zh-CN locale', () => {
      const { locale, t } = useI18n()
      locale.locale = 'zh-CN'
      expect(t('tools.pen')).toBe('画笔')
      expect(t('tools.eraser')).toBe('橡皮擦')
    })

    it('returns English for en locale', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      expect(t('tools.pen')).toBe('Pen')
      expect(t('tools.eraser')).toBe('Eraser')
    })

    it('falls back to English for unknown locale', () => {
      const { locale, t } = useI18n()
      locale.locale = 'fr'
      expect(t('tools.pen')).toBe('Pen')
    })
  })

  describe('variable substitution', () => {
    it('replaces {var} placeholders', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      const result = t('settings.shortcutsConflict', { keys: 'Ctrl+A' })
      expect(result).toBe('These shortcuts conflict or are invalid: Ctrl+A')
    })

    it('formats soft-fail registration warning', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      expect(t('settings.shortcutsSavedPartial', { keys: 'Clear: Ctrl+C' })).toBe(
        'Saved, but could not register: Clear: Ctrl+C',
      )
      locale.locale = 'zh-CN'
      expect(t('settings.shortcutNotSet')).toBe('未设置')
      expect(t('settings.shortcutsSavedPartial', { keys: '清除标注: Ctrl+C' })).toContain('已保存')
    })

    it('exposes autostart failure copy in both locales', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      expect(t('settings.autoStartFailedEnable')).toContain('login/startup')
      expect(t('settings.autoStartFailedDisable')).toContain('login/startup')
      locale.locale = 'zh-CN'
      expect(t('settings.autoStartFailedEnable')).toContain('登录项')
      expect(t('settings.autoStartFailedDisable')).toContain('登录项')
    })

    it('replaces {mod} placeholder in comboRequirement', () => {
      const { locale, t } = useI18n()
      locale.locale = 'zh-CN'
      const result = t('settings.comboRequirement', { mod: 'Ctrl' })
      expect(result).toContain('Ctrl')
      expect(result).not.toContain('{mod}')
    })

    it('replaces every occurrence of the same placeholder', () => {
      const { locale, t } = useI18n()
      locale.locale = 'zh-CN'
      const result = t('settings.dragModeDescModifier', { modKey: 'Ctrl' })
      expect(result).not.toContain('{modKey}')
      expect(result).toContain('Ctrl')
    })

    it('leaves unmatched placeholders untouched', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      const result = t('settings.shortcutsConflict', { wrong: 'value' })
      expect(result).toContain('{keys}')
    })

    it('works without vars parameter', () => {
      const { locale, t } = useI18n()
      locale.locale = 'en'
      const result = t('settings.shortcutsConflict')
      expect(result).toContain('{keys}')
    })
  })
})

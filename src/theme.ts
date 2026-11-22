import type { ThemeDefinition } from 'vuetify'

/**
 * Material Design 3 tonal scheme, seeded from a calm nursery blue (#4C8A9E).
 *
 * Vuetify's `surface-variant` is M3's inverse surface, not its neutral surface variant, so it
 * carries a dark value in the light theme. M3's neutral surfaces use `surface-container-*`.
 */

export const lightTheme: ThemeDefinition = {
  dark: false,
  colors: {
    primary: '#2E6171',
    'on-primary': '#FFFFFF',
    'primary-container': '#B3EBFB',
    'on-primary-container': '#001F28',
    'primary-darken-1': '#234B57',

    secondary: '#4F6369',
    'on-secondary': '#FFFFFF',
    'secondary-darken-1': '#3A4B50',
    'secondary-container': '#D2E7EE',
    'on-secondary-container': '#0B1F24',

    tertiary: '#5F5A7A',
    'on-tertiary': '#FFFFFF',
    'tertiary-container': '#E5DFFF',
    'on-tertiary-container': '#1B1736',

    error: '#BA1A1A',
    'on-error': '#FFFFFF',
    'error-container': '#FFDAD6',
    'on-error-container': '#410002',

    success: '#2C6B4F',
    warning: '#7D5700',
    info: '#3A656F',

    background: '#F7FAFB',
    'on-background': '#171C1E',
    surface: '#F7FAFB',
    'on-surface': '#171C1E',
    'surface-bright': '#F7FAFB',
    'surface-light': '#F1F4F5',

    'surface-container-lowest': '#FFFFFF',
    'surface-container-low': '#F1F4F5',
    'surface-container': '#EBEFF0',
    'surface-container-high': '#E5EAEB',
    'surface-container-highest': '#DFE3E5',

    'surface-variant': '#2D3133',
    'on-surface-variant': '#EFF1F2',

    outline: '#6F797D',
    'outline-variant': '#BEC8CB',
  },
  variables: {
    'border-color': '#BEC8CB',
    'border-opacity': 1,
    'medium-emphasis-opacity': 0.68,
  },
}

export const darkTheme: ThemeDefinition = {
  dark: true,
  colors: {
    primary: '#97CFE1',
    'on-primary': '#003641',
    'primary-container': '#114C5C',
    'on-primary-container': '#B3EBFB',
    'primary-darken-1': '#7AB6C8',

    secondary: '#B6CBD2',
    'on-secondary': '#203337',
    'secondary-darken-1': '#9CB2B8',
    'secondary-container': '#364A4F',
    'on-secondary-container': '#D2E7EE',

    tertiary: '#C9C2EA',
    'on-tertiary': '#302C4B',
    'tertiary-container': '#474263',
    'on-tertiary-container': '#E5DFFF',

    error: '#FFB4AB',
    'on-error': '#690005',
    'error-container': '#93000A',
    'on-error-container': '#FFDAD6',

    success: '#94D5AC',
    warning: '#F0BF52',
    info: '#A2CEDA',

    background: '#0F1416',
    'on-background': '#DFE3E5',
    surface: '#0F1416',
    'on-surface': '#DFE3E5',
    'surface-bright': '#353A3C',
    'surface-light': '#343A3C',

    'surface-container-lowest': '#0A0F11',
    'surface-container-low': '#171C1E',
    'surface-container': '#1B2123',
    'surface-container-high': '#262B2D',
    'surface-container-highest': '#303638',

    'surface-variant': '#DFE3E5',
    'on-surface-variant': '#2D3133',

    outline: '#899296',
    'outline-variant': '#3F484B',
  },
  variables: {
    'border-color': '#3F484B',
    'border-opacity': 1,
    'medium-emphasis-opacity': 0.68,
  },
}

export const themes = { light: lightTheme, dark: darkTheme }

export const defaults = {
  VCard: { rounded: 'lg' },
  VBtn: { rounded: 'xl' },
  VTextField: { variant: 'outlined' },
  VTextarea: { variant: 'outlined' },
  VSelect: { variant: 'outlined' },
  VChip: { rounded: 'lg' },
}

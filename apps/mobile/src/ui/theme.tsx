import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

// Dark = the desktop tokens (apps/desktop/src/styles/index.scss); light = the #87 mock.
const dark = {
  scheme: 'dark' as 'dark' | 'light',
  canvas: '#101216',
  panel: '#15181e',
  surface: '#1c2028',
  hover: '#252b36',
  border: '#2b303b',
  text: '#edf1f7',
  secondary: '#a0aaba',
  muted: '#8792a4',
  accent: '#6294ff',
  accentText: '#ffffff',
  selected: '#253858',
  success: '#70d5a0',
  successSoft: '#1d3a2b',
  warning: '#edbc72',
  danger: '#f0838b',
  scrim: 'rgba(0,0,0,0.62)',
};
const light: typeof dark = {
  scheme: 'light',
  canvas: '#f5f6f8',
  panel: '#ffffff',
  surface: '#ffffff',
  hover: '#eef0f4',
  border: '#e2e5ea',
  text: '#15181e',
  secondary: '#4f5868',
  muted: '#7b8494',
  accent: '#3d6ef0',
  accentText: '#ffffff',
  selected: '#e5ecff',
  success: '#239a62',
  successSoft: '#dcf3e7',
  warning: '#b9770e',
  danger: '#d64550',
  scrim: 'rgba(0,0,0,0.4)',
};
export type Theme = typeof dark;
export type ThemeMode = 'system' | 'dark' | 'light';

const ThemeContext = createContext<Theme>(dark);

// Follows the phone unless the user fixed a mode in settings (user decision, #87).
export function ThemeProvider({
  mode,
  children,
}: {
  mode: ThemeMode;
  children: ReactNode;
}) {
  const system = useColorScheme();
  const resolved =
    mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
  return (
    <ThemeContext.Provider value={resolved === 'light' ? light : dark}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
export const themes = { dark, light };

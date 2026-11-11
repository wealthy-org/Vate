import { Archivo, Instrument_Serif, JetBrains_Mono } from 'next/font/google';

// Self-hosted at build time: the browser never contacts Google Fonts.
export const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  display: 'swap',
  variable: '--font-archivo',
});
export const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-instrument',
});
export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-jetbrains',
});
export const fontVariables = `${archivo.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`;

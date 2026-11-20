import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Published on GitHub Pages at https://guarantee418.github.io/iba-boards/
export default defineConfig({ base: '/iba-boards/', plugins: [react()] });

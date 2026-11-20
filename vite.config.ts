import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Published on GitHub Pages at https://boards.ibakings.org/ (public/CNAME)
export default defineConfig({ base: '/', plugins: [react()] });

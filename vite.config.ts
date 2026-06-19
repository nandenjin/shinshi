import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const base = process.env.BASE_PATH;
if (base) {
  console.log(`Using base path: ${base}`);
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  base,
});

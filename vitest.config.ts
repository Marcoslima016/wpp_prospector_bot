import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Só o código-fonte. Evita rodar as cópias compiladas em dist/ depois de um
    // `npm run build` (além de node_modules), que quebrariam ao ler os `.md` da
    // base de conhecimento por caminho relativo ao arquivo.
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});

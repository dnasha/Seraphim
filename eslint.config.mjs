import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "data/**",
      "scripts/results/**",
      "artifacts/**",
      "eslint_report.json",
      "public/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
];

export default eslintConfig;

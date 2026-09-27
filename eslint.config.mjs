import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
   	{
      ignores: [
         	"**/dist/**",
         	"**/node_modules/**",
         	"apps/web/dist/**",
         	"coverage/**",
         	"helm/**",
         	"kubernetes/**",
         	],
      	},
   	js.configs.recommended,
   	...tseslint.configs.recommended,
   	{
      rules: {
         	"@typescript-eslint/no-unused-vars": [
               	"error",
               	{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
                     	],
         	"@typescript-eslint/no-explicit-any": "warn",
         	"no-empty": ["error", { allowEmptyCatch: true }],
               	},
      	},
   	{
      files: ["**/*.mjs"],
      languageOptions: {
         	globals: {
               	console: "readonly",
               	process: "readonly",
               	setTimeout: "readonly",
               	setInterval: "readonly",
               	clearInterval: "readonly",
               	Buffer: "readonly",
               	URL: "readonly",
               	fetch: "readonly",
                     	},
               	},
      		},
   		{
      files: ["**/*.test.ts", "**/*.test.tsx", "**/test-*.mjs", "scripts/**/*.mjs", "**/scripts/**/*.mjs"],
      rules: {
         	"@typescript-eslint/no-explicit-any": "off",
               	},
      		},
   	);

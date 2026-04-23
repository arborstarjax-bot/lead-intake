import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  { ignores: ["next-env.d.ts", ".next/**", "node_modules/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Module boundary: only the owning module may reach into its own
      // server / client / ui subtrees. Everyone else must import through
      // the module's barrel (e.g. `@/modules/leads`, not
      // `@/modules/leads/server/dedupe`). Starts in "warn" so the
      // scaffold PRs can land without a churn storm; R-9 flips to
      // "error".
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["@/modules/*/server/*", "@/modules/*/client/*", "@/modules/*/ui/*"],
              message:
                "Import from the module's barrel (e.g. '@/modules/leads') instead of reaching into server/client/ui internals.",
            },
          ],
        },
      ],
    },
  },
  {
    // The owning module is allowed to import its own subtrees.
    files: ["src/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default eslintConfig;

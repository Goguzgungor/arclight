import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/fixtures/**'] },
  ...tseslint.configs.recommended,
);

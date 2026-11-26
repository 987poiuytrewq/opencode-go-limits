declare module "*/solid-transform.js" {
  export function transformSolidSource(
    code: string,
    options: {
      filename: string;
      moduleName?: string;
      resolvePath?: (specifier: string) => string | null;
    },
  ): Promise<string>;
}

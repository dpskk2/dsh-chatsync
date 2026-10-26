// Type checking only (tsconfig.json): the vendored js-yaml build is used as
// published, so the checker reads these declarations instead of its source.
export const JSON_SCHEMA: any;
export class Type {
  constructor(tag: string, options?: any);
}
export function load(text: string, options?: any): any;
export function dump(value: any, options?: any): string;

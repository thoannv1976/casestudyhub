/**
 * Bending a response schema into the shape OpenAI insists on.
 *
 * Gemini takes a JSON Schema much as it is written. OpenAI's structured output
 * is stricter: inside `strict: true`, every object must list `additionalProperties:
 * false`, and every property must appear in `required` - there is no such thing
 * as an optional field. A field that is genuinely optional is expressed by
 * letting it be null instead.
 *
 * So the same six schemas the platform already has are translated here rather
 * than rewritten at each call site. A translation has one place to be wrong and
 * one place to be tested; six hand-edited copies have six.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Adds `null` to a property's type, which is how "optional" survives strict mode. */
function nullable(schema: Record<string, unknown>): Record<string, unknown> {
  const type = schema.type;
  if (typeof type === 'string') return { ...schema, type: [type, 'null'] };
  if (Array.isArray(type) && !type.includes('null')) return { ...schema, type: [...type, 'null'] };
  return schema;
}

export function strictJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...schema };

  if (isPlainObject(schema.properties)) {
    const wasRequired = new Set(
      Array.isArray(schema.required) ? (schema.required as unknown[]).map(String) : [],
    );

    const properties: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(schema.properties)) {
      if (!isPlainObject(child)) {
        properties[name] = child;
        continue;
      }
      const converted = strictJsonSchema(child);
      // A property the original schema did not require becomes required and
      // nullable: same meaning, expressed the only way strict mode allows.
      properties[name] = wasRequired.has(name) ? converted : nullable(converted);
    }

    result.properties = properties;
    result.required = Object.keys(properties);
    result.additionalProperties = false;
  }

  if (isPlainObject(schema.items)) {
    result.items = strictJsonSchema(schema.items);
  }

  return result;
}

/**
 * Drops the nulls that strict mode made necessary.
 *
 * `pointer: null` is how OpenAI says "there is no pointer", but the Zod schema
 * it is checked against says `.optional()`, which means absent. Without this,
 * every optional field in the platform would fail validation against OpenAI
 * and pass against Gemini - the same model answer, accepted or rejected
 * depending on the vendor.
 */
export function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === null) continue;
    result[key] = withoutNulls(child);
  }
  return result;
}

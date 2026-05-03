// Wrap zod-style schemas en middleware Express.
// Si validation OK : req.body / req.query / req.params sont remplacés par les versions parsées.
// Si KO : 400 avec liste des erreurs.

function flattenZodError(err) {
  if (!err?.issues) return [{ message: String(err?.message || err) }];
  return err.issues.map((i) => ({
    path: i.path.join("."),
    code: i.code,
    message: i.message,
  }));
}

function runSchema(schema, value) {
  if (!schema) return { ok: true, value };
  const result = schema.safeParse ? schema.safeParse(value) : null;
  if (!result) return { ok: true, value }; // pas un zod schema → on n'applique rien
  if (!result.success) return { ok: false, issues: flattenZodError(result.error) };
  return { ok: true, value: result.data };
}

export function validate({ body, query, params } = {}) {
  return (req, res, next) => {
    const checks = [
      ["body", body, req.body],
      ["query", query, req.query],
      ["params", params, req.params],
    ];
    for (const [where, schema, value] of checks) {
      const out = runSchema(schema, value);
      if (!out.ok) {
        return res.status(400).json({
          error: `Validation échouée (${where})`,
          issues: out.issues,
        });
      }
      if (schema) req[where] = out.value;
    }
    next();
  };
}

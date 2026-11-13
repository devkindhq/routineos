"""A small JSON Schema validator for the keywords the pack and catalog schemas use. Tests only.

Supported: type, const, enum, required, properties, additionalProperties (false or a schema), items,
minItems, maxItems, pattern, minLength, maxLength, patternProperties, propertyNames, maxProperties,
minimum, oneOf (exactly one branch matches), and $ref to "#/$defs/<name>". Any other keyword is an
error, so a schema cannot quietly depend on something this file does not check.
"""
import re

KNOWN = {"$schema", "$id", "title", "description", "$defs", "type", "const", "enum", "required", "properties",
         "additionalProperties", "items", "minItems", "maxItems", "pattern", "minLength", "maxLength",
         "patternProperties", "propertyNames", "maxProperties", "minimum", "$ref", "oneOf"}

TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def validate(value, schema, root=None, path="$"):
    """A list of problems; empty when value matches schema."""
    root = root if root is not None else schema
    unknown = set(schema) - KNOWN
    if unknown:
        raise ValueError(f"{path}: unsupported schema keywords {sorted(unknown)}")
    if "$ref" in schema:
        ref = schema["$ref"]
        if not ref.startswith("#/$defs/"):
            raise ValueError(f"{path}: unsupported $ref {ref}")
        return validate(value, root["$defs"][ref[len("#/$defs/"):]], root, path)
    out = []
    if "oneOf" in schema:
        hits = sum(1 for sub in schema["oneOf"] if not validate(value, sub, root, path))
        if hits != 1:
            return [f"{path}: must match exactly one of the allowed shapes"]
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(TYPES[t](value) for t in types):
            return [f"{path}: expected {'/'.join(types)}"]
    if "const" in schema and value != schema["const"]:
        out.append(f"{path}: must be {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        out.append(f"{path}: not one of {schema['enum']}")
    if isinstance(value, str):
        if "pattern" in schema and not re.search(schema["pattern"], value):
            out.append(f"{path}: does not match {schema['pattern']}")
        if len(value) < schema.get("minLength", 0):
            out.append(f"{path}: shorter than {schema['minLength']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            out.append(f"{path}: longer than {schema['maxLength']}")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            out.append(f"{path}: below {schema['minimum']}")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            out.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            out.append(f"{path}: more than {schema['maxItems']} items")
        if "items" in schema:
            for i, item in enumerate(value):
                out += validate(item, schema["items"], root, f"{path}[{i}]")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                out.append(f"{path}: missing {key}")
        if "maxProperties" in schema and len(value) > schema["maxProperties"]:
            out.append(f"{path}: more than {schema['maxProperties']} keys")
        props = schema.get("properties", {})
        patterns = schema.get("patternProperties", {})
        for key, val in value.items():
            if "propertyNames" in schema:
                out += validate(key, schema["propertyNames"], root, f"{path}.<key {key}>")
            matched = False
            if key in props:
                matched = True
                out += validate(val, props[key], root, f"{path}.{key}")
            for pat, sub in patterns.items():
                if re.search(pat, key):
                    matched = True
                    out += validate(val, sub, root, f"{path}.{key}")
            if not matched:
                extra = schema.get("additionalProperties", True)
                if extra is False:
                    out.append(f"{path}: unknown key {key}")
                elif isinstance(extra, dict):
                    out += validate(val, extra, root, f"{path}.{key}")
    return out

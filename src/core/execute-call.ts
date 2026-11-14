import { z } from "zod";
import {
  parse,
  type CallExpression,
  type Expression,
  type Program,
} from "acorn";

/** The one host operation a code-mode script starts with, in plain words. */
export type ExecuteCall = Readonly<{
  /** The operation's name, such as `bash`; never the generated handle. */
  tool: string;
  /** Its shell command text, when the call passes a literal one. */
  command: string;
  /** Whether the whole script is that one call, so it adds nothing to show. */
  alone: boolean;
}>;

/** Strip the wrappers a script puts around its call: `await`, `return`, `const x =`. */
function callOf(
  statement: Program["body"][number],
): CallExpression | undefined {
  let expression: Expression | null | undefined;
  if (statement.type === "ExpressionStatement")
    expression = statement.expression;
  else if (statement.type === "ReturnStatement")
    expression = statement.argument;
  else if (statement.type === "VariableDeclaration")
    expression = statement.declarations[0]?.init;
  while (expression?.type === "AwaitExpression")
    expression = expression.argument;
  return expression?.type === "CallExpression" ? expression : undefined;
}

const stringValue = z.string();

/** A string literal, or a template with no substitutions, as its text. */
function literalText(node: Expression | undefined): string | undefined {
  if (node?.type === "Literal") {
    const text = stringValue.safeParse(node.value);
    return text.success ? text.data : undefined;
  }
  if (node?.type === "TemplateLiteral" && node.quasis.length === 1)
    return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}

/** A property key written as an identifier or a quoted string. */
function keyName(key: Expression): string | undefined {
  return key.type === "Identifier" ? key.name : literalText(key);
}

/**
 * The first top-level `…operation({ command: "…" })` (`handle.bash(…)` or `env.computers.x.exec(…)`) in a code-mode
 * script, found with acorn so the generated Computer handle never has to be
 * shown. A script it cannot read as such yields nothing.
 */
export function executeCall(code: string): ExecuteCall | undefined {
  let program: Program;
  try {
    program = parse(code, {
      ecmaVersion: "latest",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
  } catch (cause) {
    // A script that does not parse keeps its plain first-line label; any
    // other failure is a real fault.
    if (cause instanceof SyntaxError) return undefined;
    throw cause;
  }
  for (const statement of program.body) {
    const call = callOf(statement);
    if (call === undefined) continue;
    const { callee } = call;
    if (
      callee.type !== "MemberExpression" ||
      callee.computed ||
      callee.property.type !== "Identifier"
    )
      continue;
    const argument = call.arguments[0];
    if (argument?.type !== "ObjectExpression") continue;
    for (const property of argument.properties) {
      if (
        property.type === "Property" &&
        !property.computed &&
        keyName(property.key) === "command"
      ) {
        const command = literalText(property.value);
        if (command !== undefined)
          return {
            tool: callee.property.name,
            command,
            alone: program.body.length === 1,
          };
      }
    }
  }
  return undefined;
}

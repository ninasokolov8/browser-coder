// TypeScript 5 (Strict Mode)
// All types must be explicitly defined

interface User {
  readonly id: number;
  name: string;
  email?: string;
}

const user: User = {
  id: 1,
  name: "Nina"
};

function greet(user: User): string {
  return `Hello, ${user.name}!`;
}

console.log(greet(user));

// Strict generic constraints
function identity<T extends string | number>(value: T): T {
  return value;
}

console.log(identity(42));
console.log(identity("Hello"));

// Strict null checks
function getLength(str: string | null): number {
  if (str === null) return 0;
  return str.length;
}

console.log("Length:", getLength("TypeScript"));

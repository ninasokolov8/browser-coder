// TypeScript 5
type User = {
  id: number;
  name: string;
  email?: string;
};

const user: User = {
  id: 1,
  name: "Nina"
};

function greet(user: User): string {
  return `Hello, ${user.name}!`;
}

console.log(greet(user));

// Generic function
function identity<T>(value: T): T {
  return value;
}

console.log(identity<number>(42));
console.log(identity<string>("Hello"));

// Array methods with types
const numbers: number[] = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);
console.log("Doubled:", doubled);

// JavaScript (ES2022)
const fib = (n) => n <= 1 ? n : fib(n - 1) + fib(n - 2);

console.log(`fib(10) = ${fib(10)}`);

// Modern array methods
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);
console.log("Doubled:", doubled);

// Optional chaining & nullish coalescing
const user = { name: "Nina", address: { city: "NYC" } };
console.log(user?.address?.city ?? "Unknown");

// Array.at() for negative indexing (ES2022)
console.log("Last number:", numbers.at(-1));

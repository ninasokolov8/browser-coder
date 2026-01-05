// JavaScript (ES2020)
const fib = (n) => n <= 1 ? n : fib(n - 1) + fib(n - 2);

console.log(`fib(10) = ${fib(10)}`);

// Arrow functions and array methods
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);
console.log("Doubled:", doubled);

// Optional chaining (ES2020)
const user = { name: "Nina", address: { city: "NYC" } };
console.log(user?.address?.city);

// Nullish coalescing (ES2020)
const value = null ?? "default";
console.log("Value:", value);

// BigInt (ES2020)
const bigNumber = 9007199254740991n;
console.log("BigInt:", bigNumber);

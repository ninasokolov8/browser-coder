// TypeScript (ES2020 Target)
interface User {
  id: number;
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

// Optional chaining (ES2020)
const address: { city?: string } | undefined = { city: "NYC" };
console.log(address?.city);

// Nullish coalescing (ES2020)
const value = null ?? "default";
console.log("Value:", value);

// Promise.allSettled (ES2020)
const promises = [
  Promise.resolve(1),
  Promise.reject("error"),
  Promise.resolve(3)
];

Promise.allSettled(promises).then(results => {
  console.log("Results:", results.length);
});

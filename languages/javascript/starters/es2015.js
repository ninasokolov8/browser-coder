// JavaScript (ES2015/ES6)
const fib = (n) => {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
};

console.log(`fib(10) = ${fib(10)}`);

// Arrow functions and template literals
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);
console.log("Doubled:", doubled);

// Classes (ES6)
class User {
  constructor(name) {
    this.name = name;
  }
  greet() {
    return `Hello, ${this.name}!`;
  }
}

const user = new User("Nina");
console.log(user.greet());

// Destructuring
const { name } = user;
console.log("Name:", name);

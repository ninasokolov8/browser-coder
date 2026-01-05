// TypeScript (ES2015 Target)
interface User {
  id: number;
  name: string;
}

class Greeter {
  private user: User;
  
  constructor(user: User) {
    this.user = user;
  }
  
  greet(): string {
    return `Hello, ${this.user.name}!`;
  }
}

const user: User = { id: 1, name: "Nina" };
const greeter = new Greeter(user);
console.log(greeter.greet());

// Promises (ES2015)
const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Arrow functions
const add = (a: number, b: number): number => a + b;
console.log("Sum:", add(5, 3));

// Template literals
const message = `User ${user.name} has ID ${user.id}`;
console.log(message);

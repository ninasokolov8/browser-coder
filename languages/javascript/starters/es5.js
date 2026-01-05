// JavaScript (ES5)
function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

console.log("fib(10) =", fib(10));

// Array methods (ES5 style)
var numbers = [1, 2, 3, 4, 5];
var doubled = numbers.map(function(n) { return n * 2; });
console.log("Doubled:", doubled);

// Object literal
var user = {
  name: "Nina",
  greet: function() {
    return "Hello, " + this.name + "!";
  }
};
console.log(user.greet());

// Array iteration
numbers.forEach(function(n, i) {
  console.log("Index " + i + ": " + n);
});

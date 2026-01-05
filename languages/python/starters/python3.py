# Python 3.x
def fib(n):
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)

print(f"fib(10) = {fib(10)}")

# List comprehension
numbers = [1, 2, 3, 4, 5]
doubled = [n * 2 for n in numbers]
print("Doubled:", doubled)

# Classes with type hints
class User:
    def __init__(self, name: str, age: int):
        self.name = name
        self.age = age
    
    def greet(self) -> str:
        return f"Hello, {self.name}!"

user = User("Nina", 25)
print(user.greet())

# Dictionary comprehension
squares = {n: n**2 for n in range(1, 6)}
print("Squares:", squares)

# Lambda and filter
evens = list(filter(lambda x: x % 2 == 0, numbers))
print("Evens:", evens)

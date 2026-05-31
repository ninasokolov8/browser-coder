// C# 12 (.NET 8)
using System;
using System.Collections.Generic;
using System.Linq;

// Top-level statements (C# 9+)
Console.WriteLine("Hello, C# 12!");

// Records (C# 9+)
var user = new User("Nina", 36);
Console.WriteLine($"User: {user.Name}, {user.Age}");

// Collection expressions (C# 12)
int[] numbers = [1, 2, 3, 4, 5];
Console.WriteLine($"Sum: {numbers.Sum()}");

// Pattern matching
object obj = "Hello";
if (obj is string s)
{
    Console.WriteLine($"String length: {s.Length}");
}

// Fibonacci
Console.WriteLine($"fib(10) = {Fib(10)}");

static int Fib(int n) => n < 2 ? n : Fib(n - 1) + Fib(n - 2);

public record User(string Name, int Age);

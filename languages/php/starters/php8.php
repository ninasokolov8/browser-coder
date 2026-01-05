<?php
// PHP 8.x
function fib(int $n): int {
    if ($n <= 1) return $n;
    return fib($n - 1) + fib($n - 2);
}

echo "fib(10) = " . fib(10) . "\n";

// Arrays
$numbers = [1, 2, 3, 4, 5];
$doubled = array_map(fn($n) => $n * 2, $numbers);
echo "Doubled: " . implode(", ", $doubled) . "\n";

// Constructor property promotion (PHP 8.0+)
class User {
    public function __construct(
        public string $name,
        public int $age
    ) {}
    
    public function greet(): string {
        return "Hello, {$this->name}!";
    }
}

$user = new User("Nina", 25);
echo $user->greet() . "\n";

// Named arguments (PHP 8.0+)
function createMessage(string $greeting, string $name): string {
    return "$greeting, $name!";
}
echo createMessage(name: "World", greeting: "Hello") . "\n";

// Match expression (PHP 8.0+)
$status = 200;
$message = match($status) {
    200 => "OK",
    404 => "Not Found",
    500 => "Server Error",
    default => "Unknown"
};
echo "Status: $message\n";
?>

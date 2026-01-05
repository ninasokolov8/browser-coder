// Java 17 (LTS)
public class Main {
    // Record (Java 16+)
    record User(String name, int age) {}
    
    public static void main(String[] args) {
        System.out.println("Hello, Java 17!");
        
        // Text blocks (Java 15+)
        String json = """
            {
                "name": "Nina",
                "age": 36
            }
            """;
        System.out.println(json);
        
        // Records
        var user = new User("Nina", 36);
        System.out.println("User: " + user.name() + ", " + user.age());
        
        // Pattern matching for instanceof (Java 16+)
        Object obj = "Hello";
        if (obj instanceof String s) {
            System.out.println("String length: " + s.length());
        }
        
        // Fibonacci
        System.out.println("fib(10) = " + fib(10));
    }
    
    public static int fib(int n) {
        if (n <= 1) return n;
        return fib(n - 1) + fib(n - 2);
    }
}

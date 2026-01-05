// Java 11 (LTS)
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, Java 11!");
        
        // var keyword (Java 10+)
        var message = "Using local variable type inference";
        System.out.println(message);
        
        // Fibonacci
        System.out.println("fib(10) = " + fib(10));
        
        // String methods (Java 11)
        String text = "  Hello World  ";
        System.out.println("strip(): '" + text.strip() + "'");
        System.out.println("isBlank(): " + "   ".isBlank());
        
        // Array
        int[] numbers = {1, 2, 3, 4, 5};
        System.out.print("Numbers: ");
        for (int n : numbers) {
            System.out.print(n + " ");
        }
        System.out.println();
        
        // Lambda with var
        java.util.List<String> items = java.util.List.of("a", "b", "c");
        items.forEach((var item) -> System.out.println("Item: " + item));
    }
    
    public static int fib(int n) {
        if (n <= 1) return n;
        return fib(n - 1) + fib(n - 2);
    }
}

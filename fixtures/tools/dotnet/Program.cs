// Deliberately broken: an int given a string (CS0029). Meerkat's .NET checks must reject it.
int count = "not a number";
System.Console.WriteLine(count);

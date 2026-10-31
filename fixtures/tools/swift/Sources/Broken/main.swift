// Deliberately broken: a String given to an Int (a compile error), and a force cast (a SwiftLint warning).
let number: Int = "not a number"
let anything: Any = 1
let value = anything as! Int
print(number, value)

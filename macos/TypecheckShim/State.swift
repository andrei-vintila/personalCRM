// Only for ./typecheck.sh without Xcode: the Command Line Tools lack the
// SwiftUI macro plugin behind @State, so the script rewrites @State to @ShimState in a temp copy.
// It is NOT part of the app target and has no real state semantics.
import SwiftUI

@propertyWrapper
struct ShimState<Value>: DynamicProperty {
  final class Box: @unchecked Sendable {
    var value: Value
    init(_ value: Value) { self.value = value }
  }
  private let box: Box
  init(wrappedValue: Value) { box = Box(wrappedValue) }
  init(initialValue: Value) { box = Box(initialValue) }
  var wrappedValue: Value {
    get { box.value }
    nonmutating set { box.value = newValue }
  }
  var projectedValue: Binding<Value> {
    let box = box
    return Binding(get: { box.value }, set: { box.value = $0 })
  }
}

extension ShimState where Value: ExpressibleByNilLiteral {
  init() { self.init(wrappedValue: nil) }
}

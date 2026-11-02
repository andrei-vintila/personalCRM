import SwiftUI

struct RootView: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    @Bindable var app = app
    Group {
      if app.isSignedIn {
        MainView()
      } else {
        SignInView()
      }
    }
    .alert(
      "Something went wrong",
      isPresented: Binding(get: { app.errorMessage != nil }, set: { if !$0 { app.errorMessage = nil } }),
      actions: { Button("OK") {} },
      message: { Text(app.errorMessage ?? "") })
  }
}

struct SignInView: View {
  @Environment(AppModel.self) private var app
  @State private var server = ""
  @State private var password = ""
  @State private var working = false
  @State private var error: String?

  var body: some View {
    VStack(spacing: 18) {
      Image(systemName: "person.crop.circle.badge.checkmark")
        .font(.system(size: 44, weight: .light))
        .foregroundStyle(.tint)
      VStack(spacing: 4) {
        Text("PRM").font(.title.bold())
        Text("Sign in to your self-hosted server").foregroundStyle(.secondary)
      }
      Form {
        TextField("Server", text: $server, prompt: Text("prm.example.com"))
          .textContentType(.URL)
        SecureField("Password", text: $password)
          .textContentType(.password)
          .onSubmit(submit)
      }
      .formStyle(.grouped)
      .frame(width: 380)
      .scrollDisabled(true)
      .fixedSize(horizontal: false, vertical: true)

      if let error {
        Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.callout)
      }
      Button(action: submit) {
        if working { ProgressView().controlSize(.small) } else { Text("Sign In").frame(width: 120) }
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)
      .keyboardShortcut(.defaultAction)
      .disabled(server.isEmpty || password.isEmpty || working)

      Text("The app creates its own API token, which you can revoke under Settings → API tokens on the web.")
        .font(.caption)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .frame(width: 340)
    }
    .padding(40)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .onAppear { server = app.serverURL?.absoluteString ?? "" }
  }

  private func submit() {
    guard !server.isEmpty, !password.isEmpty, !working else { return }
    working = true
    error = nil
    Task {
      do {
        try await app.signIn(server: server, password: password)
      } catch {
        self.error = error.localizedDescription
      }
      working = false
    }
  }
}

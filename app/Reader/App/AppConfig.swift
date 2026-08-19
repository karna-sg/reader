import Foundation

// Base URL (UserDefaults) + bearer token (Keychain). Defaults to the local
// server so the app works out of the box in the simulator.
enum AppConfig {
    private static let baseURLKey = "reader_base_url"
    static let defaultBaseURL = "http://127.0.0.1:8799"

    static var baseURL: String {
        get { UserDefaults.standard.string(forKey: baseURLKey) ?? defaultBaseURL }
        set { UserDefaults.standard.set(newValue, forKey: baseURLKey) }
    }

    static var token: String {
        get { Keychain.token() ?? "" }
        set { Keychain.setToken(newValue) }
    }
}

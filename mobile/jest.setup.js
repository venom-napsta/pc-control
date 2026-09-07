// In-memory AsyncStorage so the server list persistence can be tested for real.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

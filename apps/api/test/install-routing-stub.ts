import { stubRouting } from "./stub-routing";

// Applied to every test file. See stub-routing.ts for why the suite must not
// reach the real routing service.
stubRouting();

import { endpoint, username } from "../api-helpers.js";
import { getRepositories } from "../github.js";

export default endpoint(async (req) => getRepositories(username(req)), { methods: ["GET"] });

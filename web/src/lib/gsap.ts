import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Registration is idempotent. Importing this module from several components is safe.
gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

/**
 * Popover — re-exported from react-fancy.
 *
 * Background/border colors are overridden globally via data-react-fancy-popover-content
 * attribute selector in index.css.
 */

import { Popover } from "@particle-academy/react-fancy";

const PopoverTrigger = Popover.Trigger;
const PopoverContent = Popover.Content;

export { Popover, PopoverTrigger, PopoverContent };

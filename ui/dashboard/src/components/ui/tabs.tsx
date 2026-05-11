/**
 * Tabs — re-exported from react-fancy Tabs component.
 */

import { Tabs } from "@particle-academy/react-fancy";
import type { ReactNode } from "react";

interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children?: ReactNode;
}

function TabsRoot({ defaultValue, value, onValueChange, children, className }: TabsProps) {
  // react-fancy@2.9 `Tabs` requires `children` as a non-optional prop. Pass it
  // explicitly (rather than relying on the rest-spread to forward) so the
  // wrapper's optional `children?: ReactNode` shape stays compatible with
  // the upstream's required signature without `as any` casts.
  return (
    <Tabs
      defaultTab={defaultValue}
      activeTab={value}
      onTabChange={onValueChange}
      className={className}
    >
      {children}
    </Tabs>
  );
}

const TabsList = Tabs.List;
const TabsTrigger = Tabs.Tab;
const TabsContent = Tabs.Panel;

export { TabsRoot as Tabs, TabsList, TabsTrigger, TabsContent };

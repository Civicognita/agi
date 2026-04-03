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

function TabsRoot({ defaultValue, value, onValueChange, ...props }: TabsProps) {
  return <Tabs defaultTab={defaultValue} activeTab={value} onTabChange={onValueChange} {...props} />;
}

const TabsList = Tabs.List;
const TabsTrigger = Tabs.Tab;
const TabsContent = Tabs.Panel;

export { TabsRoot as Tabs, TabsList, TabsTrigger, TabsContent };

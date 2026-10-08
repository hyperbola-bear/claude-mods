// The elements a hooks module draws with, as `$.ui.resolve(e)` hands them: `Client` only where the surface has one.
import type { BoxProps, ButtonProps, ClientProps, ElementConstructor, TextProps } from 'claude-code'

export type Ui = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Client?: ElementConstructor<ClientProps>
}

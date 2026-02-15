import { AfterViewInit, Directive, ElementRef, OnDestroy } from '@angular/core';
import { Tooltip } from 'bootstrap';

@Directive({
  selector: '[appTooltip]',
  standalone: true,
})
export class TooltipDirective implements AfterViewInit, OnDestroy {
  private tooltip?: Tooltip;

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    this.tooltip = new Tooltip(this.elementRef.nativeElement, {
      container: 'body',
      trigger: 'hover focus',
    });
  }

  ngOnDestroy(): void {
    this.tooltip?.dispose();
  }
}

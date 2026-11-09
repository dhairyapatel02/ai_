import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from './badge';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Progress } from './progress';
import { Separator } from './separator';

describe('ui primitives', () => {
  it('Button applies variant classes and forwards props', () => {
    render(
      <Button variant="destructive" type="submit">
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toHaveClass('bg-destructive');
  });

  it('Badge renders its children', () => {
    render(<Badge variant="outline">Beta</Badge>);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('Card composes header, title, description and content', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    );
    expect(screen.getByTestId('card')).toHaveTextContent('TitleDescriptionBody');
  });

  it('Progress and Separator render accessible primitives', () => {
    render(
      <>
        <Progress value={40} aria-label="progress" />
        <Separator decorative={false} />
      </>,
    );
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });
});

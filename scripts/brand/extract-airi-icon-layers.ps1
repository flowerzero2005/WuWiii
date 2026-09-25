param(
  [string]$Source = (Join-Path $PSScriptRoot '..\..\docs\brand\candidates\airi-app-icon-default-character-v1.png'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\docs\brand\candidates\airi-locked-layers')
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

if (-not ('AiriMaskExtractor' -as [type])) {
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

public static class AiriMaskExtractor
{
    public static void Extract(string sourcePath, string outputDirectory)
    {
        Directory.CreateDirectory(outputDirectory);

        using (Bitmap source = new Bitmap(sourcePath))
        {
            int width = source.Width;
            int height = source.Height;
            Color[] pixels = ReadPixels(source);

            bool[] background = FloodBackground(pixels, width, height);
            bool[] lockedForeground = Invert(background);

            byte[] lockedAlpha = FeatherInside(lockedForeground, width, height);

            SaveLayer(source, lockedAlpha, Path.Combine(outputDirectory, "airi-foreground-locked.png"));
            SaveMask(background, width, height, Path.Combine(outputDirectory, "airi-background-mask.png"));
            SavePreview(source, lockedAlpha, Path.Combine(outputDirectory, "airi-mask-preview.png"));

            Console.WriteLine("source={0}x{1}", width, height);
            Console.WriteLine("background_pixels={0}", Count(background));
            Console.WriteLine("locked_foreground_pixels={0}", Count(lockedForeground));
        }
    }

    private static Color[] ReadPixels(Bitmap source)
    {
        Color[] pixels = new Color[source.Width * source.Height];
        for (int y = 0; y < source.Height; y++)
        {
            for (int x = 0; x < source.Width; x++)
            {
                pixels[y * source.Width + x] = source.GetPixel(x, y);
            }
        }
        return pixels;
    }

    private static bool[] FloodBackground(Color[] pixels, int width, int height)
    {
        bool[] selected = new bool[pixels.Length];
        Queue<int> queue = new Queue<int>();
        int sideLimit = (int)(height * 0.82);

        for (int x = 0; x < width; x++)
        {
            Seed(x, 0, pixels, selected, queue, width, height, IsBackgroundColor);
        }
        for (int y = 0; y < sideLimit; y++)
        {
            Seed(0, y, pixels, selected, queue, width, height, IsBackgroundColor);
            Seed(width - 1, y, pixels, selected, queue, width, height, IsBackgroundColor);
        }

        Flood(queue, selected, pixels, width, height, IsBackgroundColor, 0, 0, width - 1, sideLimit);
        return selected;
    }

    private static bool IsBackgroundColor(Color color)
    {
        int luminance = (299 * color.R + 587 * color.G + 114 * color.B) / 1000;
        return luminance >= 210
            && color.R >= 175
            && color.G >= 205
            && color.B >= 195
            && Math.Abs(color.R - color.G) <= 65
            && Math.Abs(color.G - color.B) <= 55;
    }

    private static bool[] Invert(bool[] input)
    {
        bool[] output = new bool[input.Length];
        for (int i = 0; i < input.Length; i++)
        {
            output[i] = !input[i];
        }
        return output;
    }

    private static byte[] FeatherInside(bool[] selected, int width, int height)
    {
        byte[] alpha = new byte[selected.Length];
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                int index = y * width + x;
                if (!selected[index])
                {
                    continue;
                }

                int neighbors = 0;
                int samples = 0;
                for (int offsetY = -2; offsetY <= 2; offsetY++)
                {
                    for (int offsetX = -2; offsetX <= 2; offsetX++)
                    {
                        int nextX = x + offsetX;
                        int nextY = y + offsetY;
                        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height)
                        {
                            continue;
                        }
                        samples++;
                        if (selected[nextY * width + nextX])
                        {
                            neighbors++;
                        }
                    }
                }

                alpha[index] = neighbors == samples
                    ? (byte)255
                    : (byte)Math.Max(96, (neighbors * 255) / samples);
            }
        }
        return alpha;
    }

    private static void Seed(int x, int y, Color[] pixels, bool[] selected, Queue<int> queue,
        int width, int height, Func<Color, bool> predicate)
    {
        if (x < 0 || y < 0 || x >= width || y >= height)
        {
            return;
        }

        int index = y * width + x;
        if (!selected[index] && predicate(pixels[index]))
        {
            selected[index] = true;
            queue.Enqueue(index);
        }
    }

    private static void Flood(Queue<int> queue, bool[] selected, Color[] pixels, int width, int height,
        Func<Color, bool> predicate, int minX, int minY, int maxX, int maxY)
    {
        int[] offsetX = { -1, 1, 0, 0 };
        int[] offsetY = { 0, 0, -1, 1 };
        while (queue.Count > 0)
        {
            int index = queue.Dequeue();
            int x = index % width;
            int y = index / width;

            for (int direction = 0; direction < 4; direction++)
            {
                int nextX = x + offsetX[direction];
                int nextY = y + offsetY[direction];
                if (nextX < minX || nextY < minY || nextX > maxX || nextY > maxY)
                {
                    continue;
                }

                int nextIndex = nextY * width + nextX;
                if (!selected[nextIndex] && predicate(pixels[nextIndex]))
                {
                    selected[nextIndex] = true;
                    queue.Enqueue(nextIndex);
                }
            }
        }
    }

    private static void SaveLayer(Bitmap source, byte[] alpha, string path)
    {
        using (Bitmap output = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb))
        {
            for (int y = 0; y < source.Height; y++)
            {
                for (int x = 0; x < source.Width; x++)
                {
                    int index = y * source.Width + x;
                    Color color = source.GetPixel(x, y);
                    output.SetPixel(x, y, Color.FromArgb(alpha[index], color.R, color.G, color.B));
                }
            }
            output.Save(path, ImageFormat.Png);
        }
    }

    private static void SaveMask(bool[] selected, int width, int height, string path)
    {
        using (Bitmap output = new Bitmap(width, height, PixelFormat.Format32bppArgb))
        {
            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    int value = selected[y * width + x] ? 255 : 0;
                    output.SetPixel(x, y, Color.FromArgb(255, value, value, value));
                }
            }
            output.Save(path, ImageFormat.Png);
        }
    }

    private static void SavePreview(Bitmap source, byte[] lockedAlpha, string path)
    {
        using (Bitmap output = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb))
        {
            for (int y = 0; y < source.Height; y++)
            {
                for (int x = 0; x < source.Width; x++)
                {
                    int index = y * source.Width + x;
                    int checker = ((x / 24) + (y / 24)) % 2 == 0 ? 218 : 168;
                    Color background = Color.FromArgb(255, checker, checker, checker);
                    Color sourceColor = source.GetPixel(x, y);
                    Color result = Composite(background, sourceColor, lockedAlpha[index]);
                    output.SetPixel(x, y, result);
                }
            }
            output.Save(path, ImageFormat.Png);
        }
    }

    private static Color Composite(Color background, Color foreground, byte alpha)
    {
        int inverse = 255 - alpha;
        int red = (foreground.R * alpha + background.R * inverse) / 255;
        int green = (foreground.G * alpha + background.G * inverse) / 255;
        int blue = (foreground.B * alpha + background.B * inverse) / 255;
        return Color.FromArgb(255, red, green, blue);
    }

    private static int Count(bool[] values)
    {
        int count = 0;
        for (int i = 0; i < values.Length; i++)
        {
            if (values[i])
            {
                count++;
            }
        }
        return count;
    }
}
'@
}

$resolvedSource = (Resolve-Path -LiteralPath $Source).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)

[AiriMaskExtractor]::Extract($resolvedSource, $resolvedOutput)
Write-Output "output=$resolvedOutput"
